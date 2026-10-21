import type { TrafficStatus } from '../lib/status';

interface Props {
  status: TrafficStatus | null;
}

/** Shown when other users' requests are queued ahead, so slower loading is expected. */
export default function TrafficNotice({ status }: Props) {
  // Below ~2 s of backlog the wait is barely noticeable; stay quiet.
  if (!status || status.busyMs < 2000) return null;
  return (
    <p className="notice info" role="status">
      <strong>Busy right now,</strong> loading will be slower.
    </p>
  );
}
