export function Toast({
  message,
  action,
  onAction,
}: {
  message: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="toast" role="status">
      <span className="toast-check">✓</span>
      <span>{message}</span>
      {action && onAction ? (
        <button className="toast-action" type="button" onClick={onAction}>
          {action}
        </button>
      ) : null}
    </div>
  );
}
