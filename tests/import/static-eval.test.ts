import { describe, expect, it } from 'vitest';
import { evalConst, parseChunk } from '../../src/import/static-eval.js';

function firstValue(source: string, type: 'ObjectExpression' | 'ArrayExpression') {
  const chunk = parseChunk(source);
  const hit = chunk.nodes.find((n) => n.node.type === type)!;
  return evalConst(hit.node, hit.ancestors);
}

/** The value of the last node of a type, which is the outermost literal of the last statement (nodes come inner first). */
function lastValue(source: string, type: 'ObjectExpression' | 'ArrayExpression') {
  const hit = parseChunk(source).nodes.findLast((n) => n.node.type === type)!;
  return evalConst(hit.node, hit.ancestors);
}

describe('evalConst', () => {
  it('evaluates Array(n).fill(value)', () => {
    expect(firstValue('let t={Custom:Array(3).fill(0),B:[1]};', 'ObjectExpression')).toEqual({ Custom: [0, 0, 0], B: [1] });
  });

  it('evaluates negative numbers', () => {
    expect(firstValue('let t=[-1,0,-3];', 'ArrayExpression')).toEqual([-1, 0, -3]);
  });

  it('refuses anything else it cannot prove constant', () => {
    expect(firstValue('let t=[f(1)];', 'ArrayExpression')).toBeUndefined();
    expect(firstValue('let t=[Array(5000).fill(0)];', 'ArrayExpression')).toBeUndefined();
  });

  it('reads members of a literal, and only its own data', () => {
    expect(lastValue('let o={a:1,b:[7,8]}; let t=[o.a,o.b[1]];', 'ArrayExpression')).toEqual([1, 8]);
    for (const member of ['o.constructor', 'o.toString', 'o.__proto__', "o['hasOwnProperty']"]) {
      expect(lastValue(`let o={a:1}; let t=[${member}];`, 'ArrayExpression'), member).toBeUndefined();
    }
  });

  it('keeps a __proto__ key as data instead of changing the prototype', () => {
    const plain = lastValue('let t={__proto__:{polluted:true},a:1};', 'ObjectExpression') as Record<string, unknown>;
    expect(Object.getPrototypeOf(plain)).toBe(Object.prototype);
    expect(Object.keys(plain)).toEqual(['__proto__', 'a']);
    expect((plain as { polluted?: boolean }).polluted).toBeUndefined();
    const spread = lastValue('let o={__proto__:1}; let t={...o,b:2};', 'ObjectExpression') as Record<string, unknown>;
    expect(Object.getPrototypeOf(spread)).toBe(Object.prototype);
    expect(Object.keys(spread)).toEqual(['__proto__', 'b']);
  });
});
