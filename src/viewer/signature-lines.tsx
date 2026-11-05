import {
  type SignatureDiff,
  type SignatureLine,
  signatureDiff,
} from '../core/signature-members.ts';

const Line = ({ line }: { readonly line: SignatureLine }) => {
  if (line.change === 'added') return <ins>+ {line.text}</ins>;
  if (line.change === 'removed') return <del>− {line.text}</del>;
  return <code>{line.text}</code>;
};

const linesOf = ({ opener, members, closer }: SignatureDiff): ReadonlyArray<SignatureLine> => [
  ...opener,
  ...members,
  ...closer,
];

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
      {linesOf(diff).map((line, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a signature's lines are fixed and may repeat
        <li key={index}>
          <Line line={line} />
        </li>
      ))}
    </ol>
  );
};
