// Text for an action the gateway refused with a Telegram limit (`code: 420` carrying `until`).
// `until` is an ISO time; `cause` is `blocklist` while the limit came from blocklist tasks.
export default function getGatewayLimitMessage(until: string, cause?: string, now = new Date()) {
  const end = new Date(until);
  const time = end.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  // A limit can run for days, and a bare time would then point at the wrong day.
  const when = end.toDateString() === now.toDateString()
    ? time
    : `${end.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${time}`;
  const reason = cause === 'blocklist' ? ': the account was blocking people from the blocklist' : '';

  return `Telegram limited this action for the account until ${when}${reason}`;
}
