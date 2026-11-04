const isFullSha = (ref: string) => /^[0-9a-f]{40}$/.test(ref);

export const shortRef = (ref: string) => (isFullSha(ref) ? ref.slice(0, 7) : ref);

export const Ref = ({ name }: { readonly name: string }) =>
  isFullSha(name) ? <abbr title={name}>{shortRef(name)}</abbr> : name;
