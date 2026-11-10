import type { Action } from './access.ts';
import type { Finding } from './findings.ts';
import type { GraphNode } from './graph.ts';
import type { AccessReading } from './read-access.ts';
import type { RouteChange } from './route-diff.ts';
import type { Route } from './routes.ts';
import { matchesWildcard } from './wildcard.ts';

type AccessFindingsOptions = {
  readonly access: ReadonlyArray<AccessReading>;
  readonly routes: ReadonlyArray<RouteChange>;
  readonly nodes: ReadonlyArray<GraphNode>;
  readonly open: ReadonlyArray<string>;
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
  const only =
    action.cover === undefined
      ? undefined
      : `${action.cover.by} covers it only under its if: or unless:`;
  if (before === undefined && only !== undefined)
    return { title: `${name} added, authorized only conditionally`, detail: `${at} ${only}.` };
  if (before === undefined)
    return {
      title: `${name} added with no authorization`,
      detail: `${at} No callback, parent or call of its own authorizes it.`,
    };
  if (before.cover?.conditional === false && only !== undefined)
    return {
      title: `${name} now authorized only conditionally`,
      detail: `${at} ${before.cover.by} covered it always before; ${only} now.`,
    };
  if (before.cover !== undefined && only === undefined)
    return {
      title: `${name} lost its authorization`,
      detail: `${at} ${before.cover.by} covered it before; nothing authorizes it now.`,
    };
  const routed = routes.find(route => reaches(route, action));
  if (routed === undefined) return undefined;
  const reached = `${at} ${routed.verb} ${routed.path} at ${routed.file}:${routed.line} now reaches it;`;
  return only === undefined
    ? {
        title: `${name} newly routed with no authorization`,
        detail: `${reached} nothing authorizes it.`,
      }
    : {
        title: `${name} newly routed, authorized only conditionally`,
        detail: `${reached} ${only}.`,
      };
};

export const accessFindings = ({
  access,
  routes,
  nodes,
  open,
}: AccessFindingsOptions): ReadonlyArray<Finding> => {
  const routedAnew = routes.flatMap(change => (change.state === 'removed' ? [] : [change.head]));
  return access.flatMap(({ base, head }) => {
    const before = new Map(base.actions.map(action => [keyOf(action), action]));
    return head.actions
      .filter(action => action.cover?.conditional !== false)
      .filter(
        ({ controller, action }) =>
          !open.some(pattern => matchesWildcard(pattern, `${controller}#${action}`)),
      )
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

export const accessNotRead = (access: ReadonlyArray<AccessReading>): ReadonlyArray<string> =>
  access.flatMap(({ head }) =>
    head.actions.flatMap(({ unread }) =>
      (unread ?? []).map(({ text, file, line }) => `${file}:${line} not read: ${text}`),
    ),
  );
