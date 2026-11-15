import { parse, type Node } from 'acorn';
import * as walk from 'acorn-walk';

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

type AnyNode = Node & Record<string, any>;

export interface ParsedChunk {
  ast: AnyNode;
  /** Every node, with the chain of its ancestors, in source order. */
  nodes: { node: AnyNode; ancestors: AnyNode[] }[];
}

/** Parses minified bundle source. The code is only read, never executed. */
export function parseChunk(source: string): ParsedChunk {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'script' }) as AnyNode;
  const nodes: ParsedChunk['nodes'] = [];
  walk.fullAncestor(ast, (node, _state, ancestors) => {
    nodes.push({ node: node as AnyNode, ancestors: [...(ancestors as AnyNode[])] });
  });
  return { ast, nodes };
}

const UNRESOLVED = Symbol('unresolved');

/**
 * Evaluates constant data expressions (literals, arrays, objects, spreads,
 * identifiers bound to such values in an enclosing scope, and member access on
 * them). Returns undefined for anything it cannot prove constant.
 */
export function evalConst(node: AnyNode, ancestors: AnyNode[]): Json | undefined {
  const result = evalNode(node, ancestors);
  return result === UNRESOLVED ? undefined : (result as Json);
}

/** Sets an own data property, also for a key like `__proto__`, which an assignment would take for the prototype. */
function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
}

function evalNode(node: AnyNode, ancestors: AnyNode[]): unknown {
  switch (node.type) {
    case 'Literal':
      return node.value;
    case 'ArrayExpression': {
      const out: unknown[] = [];
      for (const element of node.elements as AnyNode[]) {
        if (element === null) return UNRESOLVED;
        if (element.type === 'SpreadElement') {
          const spread = evalNode(element.argument, ancestors);
          if (!Array.isArray(spread)) return UNRESOLVED;
          out.push(...spread);
        } else {
          const value = evalNode(element, ancestors);
          if (value === UNRESOLVED) return UNRESOLVED;
          out.push(value);
        }
      }
      return out;
    }
    case 'ObjectExpression': {
      const out: Record<string, unknown> = {};
      for (const prop of node.properties as AnyNode[]) {
        if (prop.type === 'SpreadElement') {
          const spread = evalNode(prop.argument, ancestors);
          if (typeof spread !== 'object' || spread === null || Array.isArray(spread)) return UNRESOLVED;
          for (const [key, value] of Object.entries(spread)) setOwn(out, key, value);
          continue;
        }
        if (prop.computed) return UNRESOLVED;
        const key = prop.key.type === 'Identifier' ? prop.key.name : String(prop.key.value);
        const value = evalNode(prop.value, ancestors);
        if (value === UNRESOLVED) return UNRESOLVED;
        setOwn(out, key, value);
      }
      return out;
    }
    case 'Identifier':
      return resolveIdentifier(node.name, ancestors);
    case 'MemberExpression': {
      const object = evalNode(node.object, ancestors);
      if (typeof object !== 'object' || object === null) return UNRESOLVED;
      const key = node.computed ? evalNode(node.property, ancestors) : node.property.name;
      if (typeof key !== 'string' && typeof key !== 'number') return UNRESOLVED;
      // only the data of the literal: `constructor` or `__proto__` would resolve to members of Object.prototype
      return Object.hasOwn(object, key) ? ((object as Record<string, unknown>)[key] ?? UNRESOLVED) : UNRESOLVED;
    }
    case 'UnaryExpression': {
      const operand = evalNode(node.argument, ancestors);
      if (typeof operand !== 'number') return UNRESOLVED;
      return node.operator === '-' ? -operand : node.operator === '+' ? operand : UNRESOLVED;
    }
    case 'CallExpression':
      return evalArrayFill(node, ancestors);
    default:
      return UNRESOLVED;
  }
}

/** Supports the one call pattern bundles use for constant data: Array(n).fill(value). */
function evalArrayFill(node: AnyNode, ancestors: AnyNode[]): unknown {
  const callee = node.callee;
  const maker = callee?.type === 'MemberExpression' && callee.property?.name === 'fill' ? callee.object : null;
  const isArrayCall =
    maker?.type === 'CallExpression' && maker.callee?.type === 'Identifier' && maker.callee.name === 'Array';
  if (!isArrayCall || maker.arguments.length !== 1 || node.arguments.length !== 1) return UNRESOLVED;
  const length = evalNode(maker.arguments[0], ancestors);
  const value = evalNode(node.arguments[0], ancestors);
  if (typeof length !== 'number' || !Number.isInteger(length) || length < 0 || length > 1000) return UNRESOLVED;
  if (value === UNRESOLVED) return UNRESOLVED;
  return Array.from({ length }, () => value);
}

function resolveIdentifier(name: string, ancestors: AnyNode[]): unknown {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const scope = ancestors[i]!;
    const body = scope.type === 'Program' ? scope.body : scope.body?.type === 'BlockStatement' ? scope.body.body : null;
    if (!Array.isArray(body)) continue;
    for (const statement of body as AnyNode[]) {
      if (statement.type !== 'VariableDeclaration') continue;
      for (const declarator of statement.declarations as AnyNode[]) {
        if (declarator.id.type === 'Identifier' && declarator.id.name === name && declarator.init) {
          return evalNode(declarator.init, ancestors.slice(0, i + 1));
        }
      }
    }
  }
  return UNRESOLVED;
}
