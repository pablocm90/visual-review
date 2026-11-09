import type { Action } from './access.ts';
import type { Finding } from './findings.ts';
import type { GraphNode } from './graph.ts';
import type { AccessReading } from './read-access.ts';
import type { RouteChange } from './route-diff.ts';
import type { Route } from './routes.ts';

type AccessFindingsOptions = {
  readonly access: ReadonlyArray<AccessReading>;
  readonly routes: ReadonlyArray<RouteChange>;
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

type Change = {
  readonly action: Action;
  readonly before: Action | undefined;
  readonly routes: ReadonlyArray<Route>;
};

const reaches = (route: Route, { root, controllerPath, action }: Action): boolean =>
  route.root === root && route.target === `${controllerPath}#${action}`;

const whatChanged = ({
  action,
  before,
  routes,
}: Change): { readonly title: string; readonly detail: string } | undefined => {
  const at = `At ${action.file}:${action.line}.`;
  const name = `${action.controller}#${action.action}`;
  if (before === undefined && action.cover !== undefined)
    return {
      title: `${name} added, authorized only conditionally`,
      detail: `${at} ${action.cover.by} covers it only under its if: or unless:.`,
    };
  if (before === undefined)
    return {
      title: `${name} added with no authorization`,
      detail: `${at} No callback, parent or call of its own authorizes it.`,
    };
  if (action.cover !== undefined)
    return before.cover?.conditional === false
      ? {
          title: `${name} now authorized only conditionally`,
          detail: `${at} ${before.cover.by} covered it always before; ${action.cover.by} covers it only under its if: or unless: now.`,
        }
      : undefined;
  if (before.cover !== undefined)
    return {
      title: `${name} lost its authorization`,
      detail: `${at} ${before.cover.by} covered it before; nothing authorizes it now.`,
    };
  const routed = routes.find(route => reaches(route, action));
  return routed === undefined
    ? undefined
    : {
        title: `${name} newly routed with no authorization`,
        detail: `${at} ${routed.verb} ${routed.path} at ${routed.file}:${routed.line} now reaches it; nothing authorizes it.`,
      };
};

export const accessFindings = ({
  access,
  routes,
  nodes,
}: AccessFindingsOptions): ReadonlyArray<Finding> => {
  const routedAnew = routes.flatMap(change => (change.state === 'removed' ? [] : [change.head]));
  return access.flatMap(({ base, head }) => {
    const before = new Map(base.actions.map(action => [keyOf(action), action]));
    return head.actions
      .filter(action => action.cover?.conditional !== false)
      .flatMap((action): ReadonlyArray<Finding> => {
        const change = whatChanged({
          action,
          before: before.get(keyOf(action)),
          routes: routedAnew,
        });
        return change === undefined
          ? []
          : [
              {
                id: `security:unauthorized:${keyOf(action)}`,
                check: 'security:unauthorized',
                dimension: 'security',
                level: action.cover === undefined ? 'look' : 'info',
                ...nodeOf(nodes, action),
                ...change,
              },
            ];
      });
  });
};
