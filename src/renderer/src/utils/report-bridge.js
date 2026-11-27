// Lets any error toast open the problem-report dialog without threading a
// callback through every hook: App registers the opener once, and error
// sites pass reportToastOptions(...) as the toast's options.
import { TOAST_LONG_DURATION_MS } from '../hooks/useToast';

let opener = null;

export function setReportOpener(fn) {
  opener = typeof fn === 'function' ? fn : null;
}

/** Opens the report dialog. source: 'settings' | 'error-toast'; context: the error text. */
export function openReport(source, context = null) {
  if (opener) opener({ source, context: typeof context === 'string' ? context : null });
}

/** Toast options for an install / update failure: stays up longer, with a "Report this problem" button. */
export function reportToastOptions(t, message) {
  return {
    duration: TOAST_LONG_DURATION_MS,
    action: { label: t.reportThisProblem, onClick: () => openReport('error-toast', message) },
  };
}
