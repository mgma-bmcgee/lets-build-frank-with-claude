// Overview: Frank's get_status output and whether the console can reach him.
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useCallback, useEffect, useState } from 'react';
import type { Notify } from '../App';
import { callTool, describeError } from '../mcp';

interface Status {
  summary: string;
  version: string;
  uptimeSeconds: number;
  startedAt: string;
  greeting: string;
}

type State = { kind: 'loading' } | { kind: 'ok'; status: Status } | { kind: 'error'; message: string };

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function OverviewPage({ onError }: { onError: Notify }) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  const refresh = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const result = await callTool('get_status', {});
      if (result.isError) throw new Error(result.text || 'get_status failed.');
      setState({ kind: 'ok', status: result.data as Status });
    } catch (err) {
      const message = describeError(err);
      setState({ kind: 'error', message });
      onError(message);
    }
  }, [onError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const connection =
    state.kind === 'loading' ? (
      <StatusIndicator type="loading">Connecting</StatusIndicator>
    ) : state.kind === 'ok' ? (
      <StatusIndicator type="success">Connected</StatusIndicator>
    ) : (
      <StatusIndicator type="error">Unreachable</StatusIndicator>
    );

  return (
    <ContentLayout header={<Header variant="h1">Overview</Header>}>
      <Container
        header={
          <Header
            variant="h2"
            description={state.kind === 'ok' ? state.status.summary : undefined}
            actions={
              <Button iconName="refresh" onClick={() => void refresh()} loading={state.kind === 'loading'}>
                Refresh
              </Button>
            }
          >
            Status
          </Header>
        }
      >
        {state.kind === 'error' ? (
          <Box>
            {connection} <Box variant="span">{state.message}</Box>
          </Box>
        ) : (
          <KeyValuePairs
            columns={4}
            items={[
              { label: 'Connection', value: connection },
              { label: 'Version', value: state.kind === 'ok' ? state.status.version : '-' },
              { label: 'Uptime', value: state.kind === 'ok' ? formatUptime(state.status.uptimeSeconds) : '-' },
              { label: 'Greeting', value: state.kind === 'ok' ? state.status.greeting : '-' },
            ]}
          />
        )}
      </Container>
    </ContentLayout>
  );
}
