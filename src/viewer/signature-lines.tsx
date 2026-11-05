import {
  type SignatureDiff,
  type SignatureLine,
  signatureDiff,
} from '../core/signature-members.ts';

type Fold = { readonly folded: ReadonlyArray<SignatureLine> };

const foldedRuns = (members: ReadonlyArray<SignatureLine>): ReadonlyArray<SignatureLine | Fold> =>
  members.flatMap((line, index): ReadonlyArray<SignatureLine | Fold> => {
    if (line.change !== 'same') return [line];
    if (members[index - 1]?.change === 'same') return [];
    const after = members.slice(index);
    const end = after.findIndex(({ change }) => change !== 'same');
    return [{ folded: end === -1 ? after : after.slice(0, end) }];
  });

const rowsOf = ({
  opener,
  members,
  closer,
}: SignatureDiff): ReadonlyArray<SignatureLine | Fold> => [
  ...opener,
  ...foldedRuns(members),
  ...closer,
];

const Line = ({ line }: { readonly line: SignatureLine }) => {
  if (line.change === 'added') return <ins>+ {line.text}</ins>;
  if (line.change === 'removed') return <del>− {line.text}</del>;
  if (line.change === 'changed')
    return (
      <>
        ~ <del>{line.base}</del> → <ins>{line.head}</ins>
      </>
    );
  return <code className="signature-line">{line.text}</code>;
};

const AsTheyWere = ({ folded }: Fold) => (
  <details>
    <summary className="signature-fold-summary">
      … {folded.length} {folded.length === 1 ? 'member as it was' : 'members as they were'}
    </summary>
    {folded.map((line, index) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: a signature's lines are fixed and may repeat
      <Line key={index} line={line} />
    ))}
  </details>
);

export const Signature = ({
  name,
  signature,
}: {
  readonly name: string;
  readonly signature: { readonly base: string; readonly head: string };
}) => {
  const diff = signatureDiff(signature);
  return diff === undefined ? (
    <span className="signature">
      <del>{signature.base}</del>
      <ins>{signature.head}</ins>
    </span>
  ) : (
    <ol className="signature signature-lines" aria-label={`Signature of ${name}`}>
      {rowsOf(diff).map((row, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a signature's lines are fixed and may repeat
        <li key={index}>{'folded' in row ? <AsTheyWere {...row} /> : <Line line={row} />}</li>
      ))}
    </ol>
  );
};
