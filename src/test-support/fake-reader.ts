import type { Graph } from '../core/graph.ts';
import type { Reader } from '../core/reader.ts';

type FakeReaderOptions = {
  readonly graphs: Readonly<Record<string, Graph>>;
  readonly stacks: Readonly<Record<string, string>>;
};

export const fakeReader = ({ graphs, stacks }: FakeReaderOptions): Reader => ({
  name: 'rails',
  stackFields: [],
  open: () => ({
    stacks: new Map(Object.entries(stacks)),
    graph: async root => graphs[root] ?? { nodes: [], edges: [] },
  }),
  isTestFile: () => false,
  readTests: () => [],
});
