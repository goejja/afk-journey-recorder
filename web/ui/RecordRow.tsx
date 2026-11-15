import type { ReactNode } from 'react';

/**
 * The first line of a repeated record or entity row. Facts stay together on the left; actions sit together on the right
 * and inherit the same compact control size everywhere.
 */
export function RecordRow({ children, actions, infoClassName }: { children: ReactNode; actions: ReactNode; infoClassName?: string }) {
  return (
    <div className="attempt-top">
      <div className={['attempt-info', infoClassName].filter(Boolean).join(' ')}>{children}</div>
      <div className="attempt-actions">{actions}</div>
    </div>
  );
}
