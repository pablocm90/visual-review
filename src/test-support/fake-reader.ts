import type { ReaderName } from '../core/config.ts';
import type { Reader } from '../core/reader.ts';

type FakeReaderOptions = Partial<Pick<Reader, 'holds' | 'graph'>> & {
  readonly name?: ReaderName;
  readonly roots: ReturnType<Reader['roots']>;
};

export const fakeReader = ({
  name = 'rails',
  roots,
  holds = () => true,
  graph = async ({ root, stack }) => ({
    nodes: [{ id: stack, kind: 'stack', label: stack, path: root }],
    edges: [],
  }),
}: FakeReaderOptions): Reader => ({
  name,
  stackFields: [],
  roots: () => roots,
  holds,
  graph,
  isTestFile: () => false,
  readTests: () => [],
});
