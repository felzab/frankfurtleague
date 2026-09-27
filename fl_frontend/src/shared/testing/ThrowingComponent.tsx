// A type rather than inline props: its lines compile away above the throw, which is what makes an
// unmapped stack name a line this file does not hold there.
type ThrowingComponentProps = {
  message: string;
};

export function ThrowingComponent({ message }: ThrowingComponentProps) {
  if (message !== "") throw new Error(message);
  return <span>{message}</span>;
}
