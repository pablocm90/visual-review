import { createContext, useContext } from 'react';
import type { ChangedSince } from '../core/since-review.ts';

export const ChangedSinceMarks = createContext<ChangedSince | undefined>(undefined);

export const useIsChangedSince = () => {
  const since = useContext(ChangedSinceMarks);
  return (kind: Exclude<keyof ChangedSince, 'dropped'>, id: string): boolean =>
    since?.[kind].includes(id) ?? false;
};

export const sinceLabel = (label: string, marked: boolean): string =>
  marked ? `${label}, changed since` : label;

export const ChangedSinceTag = () => <span className="changed-since">changed since</span>;
