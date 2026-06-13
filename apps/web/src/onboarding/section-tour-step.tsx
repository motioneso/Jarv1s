export function SectionTourStep(props: { readonly onDone: () => void }) {
  return (
    <button className="primary-button" type="button" onClick={props.onDone}>
      Finish
    </button>
  );
}
