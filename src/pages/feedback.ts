// The author's note asking for a rating and a comment, with the Ko-fi link second. It appears as a card in the
// popup, on the report page and in Settings after a week, a month and three months of use (never as a system
// notification, never while YouTube is blocked), and permanently in the Support block at the end of Settings.
import { APP_NAME, link, storeReviewsUrl } from '../shared/brand';
import type { FeedbackAction } from '../shared/messages';
import { request } from '../runtime/rpc';
import { h } from './dom';

/** The note itself. The Ko-fi sentence is left out while no link is set. */
export function supportNote(): HTMLElement {
  const tips = link('tips');
  return h(
    'p',
    { class: 'note' },
    `Hey, I'm the creator of ${APP_NAME}. I care whether it has helped you. Please rate it and leave a comment: your feedback matters most to me. `,
    tips ? 'You can also support me on Ko-fi if you like. ' : null,
    "Let's reclaim our lives!",
  );
}

/** "Rate and comment" and, when a link is set, "Support on Ko-fi". `onUse` runs when either is clicked. */
export function supportButtons(onUse?: (action: FeedbackAction) => void): HTMLElement[] {
  const tips = link('tips');
  const buttons = [
    h(
      'a',
      { class: 'btn primary', href: storeReviewsUrl(chrome.runtime.id), target: '_blank', rel: 'noopener', onClick: () => onUse?.('rate') },
      'Rate and comment',
    ),
  ];
  if (tips) {
    buttons.push(h('a', { class: 'btn', href: tips, target: '_blank', rel: 'noopener', onClick: () => onUse?.('tips') }, 'Support on Ko-fi'));
  }
  return buttons;
}

/**
 * The reminder card, or null when none is due. Every button answers the reminder (it stays away until the next
 * milestone); "Don't ask again" also switches the reminders off. `redraw` is called once the answer is stored.
 */
export async function feedbackCard(redraw: () => void): Promise<HTMLElement | null> {
  let due: number | null = null;
  try {
    due = (await request('getOnboarding', {})).feedbackDue;
  } catch {
    return null;
  }
  if (due === null) return null;
  const answer = (action: FeedbackAction): void => {
    void request('feedbackAction', { action })
      .catch(() => undefined)
      .then(redraw);
  };
  return h(
    'div',
    { class: 'card feedback' },
    supportNote(),
    h(
      'div',
      { class: 'row' },
      ...supportButtons(answer),
      h('button', { class: 'link', onClick: () => answer('later') }, 'Later'),
      h('button', { class: 'link', onClick: () => answer('never') }, "Don't ask again"),
    ),
  );
}
