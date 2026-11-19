import { ArrowDownRight, ArrowUpRight, Minus, type IconNode } from 'lucide';
import { icon } from './cards';
import { sideCard, type SideDeps, type Tone } from './services';
import { t } from '../i18n';

/** ok = price up, error = down. */
export const trendIcon = (tone: Tone): IconNode => (tone === 'ok' ? ArrowUpRight : tone === 'error' ? ArrowDownRight : Minus);

/** Crypto holdings and prices from side settings. */
export function portfolioView(deps: SideDeps): HTMLElement {
  return sideCard(
    {
      id: 'crypto',
      title: t('portfolio.title'),
      grant: t('portfolio.permission'),
      empty: t('portfolio.empty'),
      lead: (item) => {
        const el = icon(trendIcon(item.tone), 11) as Element;
        el.classList.add('side-trend');
        return el;
      },
    },
    deps,
  );
}
