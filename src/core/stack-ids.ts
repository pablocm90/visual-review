type StackIdsOptions = {
  readonly roots: ReadonlyArray<string>;
  readonly taken: ReadonlySet<string>;
  readonly idOf: (root: string) => string;
};

export const stackIds = ({ roots, taken, idOf }: StackIdsOptions): ReadonlyMap<string, string> =>
  roots.reduce<{
    readonly used: ReadonlySet<string>;
    readonly stacks: ReadonlyMap<string, string>;
  }>(
    (sofar, root) => {
      const stack = idOf(root);
      const free = (n: number): string =>
        sofar.used.has(`${stack}~${n}`) ? free(n + 1) : `${stack}~${n}`;
      const id = sofar.used.has(stack) ? free(2) : stack;
      return { used: new Set([...sofar.used, id]), stacks: new Map([...sofar.stacks, [root, id]]) };
    },
    { used: taken, stacks: new Map() },
  ).stacks;
