// Frank's console shell (ADR-003): Cloudscape AppLayout with two pages,
// switched by the URL hash so no router is needed.
import AppLayout from '@cloudscape-design/components/app-layout';
import Flashbar, { type FlashbarProps } from '@cloudscape-design/components/flashbar';
import SideNavigation from '@cloudscape-design/components/side-navigation';
import { useCallback, useEffect, useState } from 'react';
import { OverviewPage } from './pages/Overview';
import { ToolsPage } from './pages/Tools';

type Page = 'overview' | 'tools';

function pageFromHash(hash: string): Page {
  return hash.startsWith('#/tools') ? 'tools' : 'overview';
}

export type Notify = (message: string) => void;

export function App() {
  const [page, setPage] = useState<Page>(() => pageFromHash(window.location.hash));
  const [flashes, setFlashes] = useState<FlashbarProps.MessageDefinition[]>([]);

  useEffect(() => {
    const onHash = () => setPage(pageFromHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const notifyError: Notify = useCallback((message) => {
    const id = String(Date.now() + Math.random());
    setFlashes((current) => [
      ...current,
      {
        id,
        type: 'error',
        content: message,
        dismissible: true,
        onDismiss: () => setFlashes((all) => all.filter((f) => f.id !== id)),
      },
    ]);
  }, []);

  return (
    <AppLayout
      navigation={
        <SideNavigation
          header={{ href: '#/', text: 'Frank' }}
          activeHref={page === 'tools' ? '#/tools' : '#/'}
          items={[
            { type: 'link', text: 'Overview', href: '#/' },
            { type: 'link', text: 'Tools', href: '#/tools' },
          ]}
        />
      }
      notifications={<Flashbar items={flashes} />}
      toolsHide
      content={page === 'tools' ? <ToolsPage onError={notifyError} /> : <OverviewPage onError={notifyError} />}
    />
  );
}
