import type { Action } from './access.ts';
import type { Finding } from './findings.ts';
import type { GraphNode } from './graph.ts';
import type { AccessReading } from './read-access.ts';

type AccessFindingsOptions = {
  readonly access: ReadonlyArray<AccessReading>;
  readonly nodes: ReadonlyArray<GraphNode>;
};

const keyOf = ({ root, controller, action }: Action): string => `${root}:${controller}#${action}`;

const nodeOf = (
  nodes: ReadonlyArray<GraphNode>,
  { file }: Action,
): { readonly target: string } | { readonly file: string } => {
  const node = nodes.find(({ path }) => path === file);
  return node === undefined ? { file } : { target: node.id };
};

export const accessFindings = ({ access, nodes }: AccessFindingsOptions): ReadonlyArray<Finding> =>
  access.flatMap(({ base, head }) => {
    const before = new Set(base.actions.map(keyOf));
    return head.actions
      .filter(action => action.cover === undefined && !before.has(keyOf(action)))
      .map(action => ({
        id: `security:unauthorized:${keyOf(action)}`,
        check: 'security:unauthorized',
        dimension: 'security',
        level: 'look',
        ...nodeOf(nodes, action),
        title: `${action.controller}#${action.action} added with no authorization`,
        detail: `At ${action.file}:${action.line}. No callback, parent or call of its own authorizes it.`,
      }));
  });
