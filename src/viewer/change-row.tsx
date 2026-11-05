import type { ReactNode } from 'react';

export type ChangeState = 'added' | 'removed' | 'changed';

export const CHANGE_MARKS: Readonly<Record<ChangeState, string>> = {
  added: '+',
  removed: '−',
  changed: '~',
};

export const STATE_NAMES: Readonly<Record<ChangeState, string>> = {
  added: 'added',
  removed: 'removed',
  changed: 'modified',
};

type ChangeRowProps = {
  readonly name: string;
  readonly state: ChangeState;
  readonly base: string;
  readonly head: string;
  readonly place?: string;
  readonly children?: ReactNode;
};

export const ChangeRow = ({ name, state, base, head, place, children }: ChangeRowProps) => (
  <tr data-state={STATE_NAMES[state]} {...(place !== undefined && { id: place, tabIndex: -1 })}>
    <td className="schema-mark">{CHANGE_MARKS[state]}</td>
    <th scope="row" className="schema-name">
      {name}
    </th>
    <td className="schema-side">{base}</td>
    <td className="schema-side">{head}</td>
    {children}
  </tr>
);
