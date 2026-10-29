import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import type { DiffedEdge, DiffedNode, GraphDiff } from '../core/diff-graphs.ts';

type Box = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

type Point = { readonly x: number; readonly y: number };

export type PlacedNode = DiffedNode & Box & { readonly children: ReadonlyArray<PlacedNode> };

export type PlacedEdge = DiffedEdge & { readonly points: ReadonlyArray<Point> };

export type PlacedStack = PlacedNode & { readonly edges: ReadonlyArray<PlacedEdge> };

export type Layout = {
  readonly width: number;
  readonly height: number;
  readonly stacks: ReadonlyArray<PlacedStack>;
  readonly calls: ReadonlyArray<PlacedEdge>;
};

const NODE_HEIGHT = 36;

const RENAMED_NODE_HEIGHT = 50;

const sizeOf = ({ label, formerLabel }: DiffedNode) =>
  formerLabel === undefined
    ? { width: nodeWidth(label), height: NODE_HEIGHT }
    : {
        width: Math.max(nodeWidth(label), nodeWidth(`was ${formerLabel}`)),
        height: RENAMED_NODE_HEIGHT,
      };

const nodeWidth = (label: string): number => 24 + label.length * 8;

const elk = new ELK();

const boxesIn = (node: ElkNode, offset: Point = { x: 0, y: 0 }): ReadonlyArray<[string, Box]> => {
  const box = {
    x: offset.x + (node.x ?? 0),
    y: offset.y + (node.y ?? 0),
    width: node.width ?? 0,
    height: node.height ?? 0,
  };
  return [[node.id, box], ...(node.children ?? []).flatMap(child => boxesIn(child, box))];
};

const middleY = (box: Box): number => box.y + box.height / 2;

type CallPointsOptions = {
  readonly from: Box;
  readonly to: Box;
  readonly fromStack: Box;
  readonly toStack: Box;
};

const STACK_TITLE_LANE = 34;

const callPoints = ({ from, to, fromStack, toStack }: CallPointsOptions): ReadonlyArray<Point> => {
  const leftward = fromStack.x > toStack.x;
  const start = { x: leftward ? from.x : from.x + from.width, y: middleY(from) };
  const gap = leftward
    ? (fromStack.x + toStack.x + toStack.width) / 2
    : (fromStack.x + fromStack.width + toStack.x) / 2;
  const lane = toStack.y + STACK_TITLE_LANE;
  const above = to.x + to.width / 2;
  return [
    start,
    { x: gap, y: start.y },
    { x: gap, y: lane },
    { x: above, y: lane },
    { x: above, y: to.y },
  ];
};

export const layoutDiff = async (diff: GraphDiff): Promise<Layout> => {
  const stacks = diff.nodes.filter(node => node.kind === 'stack');
  const childrenOf = (id: string) => diff.nodes.filter(node => node.parent === id);
  const descendantsOf = (id: string): ReadonlyArray<DiffedNode> =>
    childrenOf(id).flatMap(node => [node, ...descendantsOf(node.id)]);
  const stackOf = new Map(
    stacks.flatMap(stack =>
      [stack, ...descendantsOf(stack.id)].map(node => [node.id, stack.id] as const),
    ),
  );
  const edgesOf = (stack: DiffedNode) =>
    diff.edges.filter(
      edge => stackOf.get(edge.from) === stack.id && stackOf.get(edge.to) === stack.id,
    );
  const calls = diff.edges.filter(edge => stackOf.get(edge.from) !== stackOf.get(edge.to));
  const elkNodeOf = (node: DiffedNode): ElkNode => {
    const children = childrenOf(node.id);
    return children.length === 0
      ? { id: node.id, ...sizeOf(node) }
      : {
          id: node.id,
          layoutOptions: {
            'elk.padding': `[top=${node.formerLabel === undefined ? 40 : 54},left=16,bottom=16,right=16]`,
          },
          children: children.map(elkNodeOf),
        };
  };
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.padding': '[top=16,left=16,bottom=16,right=16]',
      'elk.spacing.nodeNode': '32',
      'elk.layered.considerModelOrder.components': 'MODEL_ORDER',
      'elk.aspectRatio': '100',
      'elk.json.edgeCoords': 'PARENT',
    },
    children: stacks.map(stack => ({
      id: stack.id,
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'DOWN',
        'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
        'elk.padding': '[top=44,left=24,bottom=24,right=24]',
        'elk.spacing.nodeNode': '28',
        'elk.layered.spacing.nodeNodeBetweenLayers': '56',
        'elk.edgeRouting': 'SPLINES',
      },
      children: childrenOf(stack.id).map(elkNodeOf),
      edges: edgesOf(stack).map((edge, index) => ({
        id: `${stack.id}#${index}`,
        sources: [edge.from],
        targets: [edge.to],
      })),
    })),
  };
  const laidOut = await elk.layout(graph);
  const placedOf = (node: DiffedNode, among: ReadonlyArray<ElkNode> = []): PlacedNode => {
    const laid = among.find(item => item.id === node.id);
    return {
      ...node,
      x: laid?.x ?? 0,
      y: laid?.y ?? 0,
      width: laid?.width ?? 0,
      height: laid?.height ?? 0,
      children: childrenOf(node.id).map(child => placedOf(child, laid?.children)),
    };
  };
  const boxes = new Map(boxesIn(laidOut));
  const boxOf = (id: string | undefined): Box =>
    boxes.get(id ?? '') ?? { x: 0, y: 0, width: 0, height: 0 };
  return {
    width: laidOut.width ?? 0,
    height: laidOut.height ?? 0,
    calls: calls.map(edge => ({
      ...edge,
      points: callPoints({
        from: boxOf(edge.from),
        to: boxOf(edge.to),
        fromStack: boxOf(stackOf.get(edge.from)),
        toStack: boxOf(stackOf.get(edge.to)),
      }),
    })),
    stacks: stacks.map(stack => {
      const laidStack = laidOut.children?.find(child => child.id === stack.id);
      return {
        ...placedOf(stack, laidOut.children),
        edges: edgesOf(stack).map((edge, index) => {
          const section = laidStack?.edges?.find(laid => laid.id === `${stack.id}#${index}`)
            ?.sections?.[0];
          return {
            ...edge,
            points: section
              ? [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]
              : [],
          };
        }),
      };
    }),
  };
};
