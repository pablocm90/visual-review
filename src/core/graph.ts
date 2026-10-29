/**
 * A box in the review graph. `id` is the node's contract: notes are keyed by it, so a reader
 * keeps it stable across versions. Ids are `<stack>/<word>/<name>` under the reader's stack id,
 * e.g. `rust/crate/http-adapter`, `rust/mod/application/sign_up`, `web/module/utils`,
 * `web/file/App.tsx`, `shop/layer/models`, `shop/class/Admin::UsersController` (a Rails class, keyed
 * by its constant); the stack's own node is just `<stack>`. An edge is keyed `<from> -> <to>`
 * (`edgeId`), so a node id never contains ` -> `.
 */
export type GraphNode = {
  readonly id: string;
  readonly kind: 'stack' | 'package' | 'module' | 'file';
  readonly label: string;
  readonly parent?: string;
  readonly path: string;
};

export type GraphEdge = {
  readonly from: string;
  readonly to: string;
  readonly via?: ReadonlyArray<string>;
};

export type Graph = {
  readonly nodes: ReadonlyArray<GraphNode>;
  readonly edges: ReadonlyArray<GraphEdge>;
};

export const edgeId = (edge: GraphEdge): string => `${edge.from} -> ${edge.to}`;

export const stackOfIn = (nodes: ReadonlyArray<GraphNode>): ((id: string) => string) => {
  const parents = new Map(nodes.map(node => [node.id, node.parent]));
  const stackOf = (id: string): string => {
    const parent = parents.get(id);
    return parent === undefined ? id : stackOf(parent);
  };
  return stackOf;
};
