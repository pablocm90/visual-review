import type { ReaderName } from '../core/config.ts';
import type { Linker } from '../core/linker.ts';
import type { Reader } from '../core/reader.ts';

type FakeReaderOptions = Partial<
  Pick<Reader, 'name' | 'tool' | 'stackFields' | 'holds' | 'graph'>
> & {
  readonly roots: ReturnType<Reader['roots']>;
};

export const fakeReader = ({
  roots,
  name = 'rails',
  stackFields = [],
  holds = () => true,
  graph = async ({ root, stack }) => ({
    nodes: [{ id: stack, kind: 'stack', label: stack, path: root }],
    edges: [],
  }),
  ...tool
}: FakeReaderOptions): Reader => ({
  name,
  ...tool,
  stackFields,
  roots: () => roots,
  holds,
  graph,
  isTestFile: () => false,
  readTests: () => [],
});

type FakeLinkerOptions = {
  readonly from: ReaderName;
  readonly to: ReaderName;
};

export const fakeLinker = ({ from, to }: FakeLinkerOptions): Linker => ({
  name: 'fetch-axum',
  from,
  to,
  link: async options => ({
    edges: options.from.flatMap(({ nodes }) =>
      nodes.flatMap(node => options.to.map(({ stack }) => ({ from: node.id, to: stack }))),
    ),
    dangling: options.from.map(({ stack }) => ({ from: stack, path: '/missing' })),
  }),
});
