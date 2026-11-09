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

const whatChanged = (
  action: Action,
  before: Action | undefined,
): { readonly title: string; readonly detail: string } | undefined => {
  const at = `At ${action.file}:${action.line}.`;
  const name = `${action.controller}#${action.action}`;
  if (before === undefined)
    return {
      title: `${name} added with no authorization`,
      detail: `${at} No callback, parent or call of its own authorizes it.`,
    };
  if (before.cover === undefined) return undefined;
  return {
    title: `${name} lost its authorization`,
    detail: `${at} ${before.cover.by} covered it before; nothing authorizes it now.`,
  };
};

export const accessFindings = ({ access, nodes }: AccessFindingsOptions): ReadonlyArray<Finding> =>
  access.flatMap(({ base, head }) => {
    const before = new Map(base.actions.map(action => [keyOf(action), action]));
    return head.actions
      .filter(action => action.cover === undefined)
      .flatMap((action): ReadonlyArray<Finding> => {
        const change = whatChanged(action, before.get(keyOf(action)));
        return change === undefined
          ? []
          : [
              {
                id: `security:unauthorized:${keyOf(action)}`,
                check: 'security:unauthorized',
                dimension: 'security',
                level: 'look',
                ...nodeOf(nodes, action),
                ...change,
              },
            ];
      });
  });
