// Tools: everything Frank exposes, from MCP discovery. Selecting a tool renders
// a form from its input schema (schemaForm.ts) and shows the JSON result.
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Checkbox from '@cloudscape-design/components/checkbox';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Notify } from '../App';
import { callTool, describeError, type FrankTool, listTools, type ToolResult } from '../mcp';
import { buildArgs, type Field, type FormValues, initialValues, schemaToFields } from '../schemaForm';

export function ToolsPage({ onError }: { onError: Notify }) {
  const [tools, setTools] = useState<FrankTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<FrankTool | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const found = await listTools();
      setTools(found);
      setSelected((current) => found.find((t) => t.name === current?.name) ?? found[0] ?? null);
    } catch (err) {
      onError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ContentLayout header={<Header variant="h1">Tools</Header>}>
      <SpaceBetween size="l">
        <Table
          header={
            <Header
              counter={loading ? undefined : `(${tools.length})`}
              description="Discovered from Frank over MCP. Every tool is read-only."
              actions={
                <Button iconName="refresh" onClick={() => void load()} loading={loading}>
                  Refresh
                </Button>
              }
            >
              Tools
            </Header>
          }
          items={tools}
          loading={loading}
          loadingText="Asking Frank for his tools"
          trackBy="name"
          selectionType="single"
          selectedItems={selected ? [selected] : []}
          onSelectionChange={({ detail }) => setSelected(detail.selectedItems[0] ?? null)}
          ariaLabels={{
            selectionGroupLabel: 'Tools',
            itemSelectionLabel: (_data, item) => item.name,
          }}
          columnDefinitions={[
            { id: 'name', header: 'Name', cell: (t) => <Box variant="code">{t.name}</Box>, isRowHeader: true },
            { id: 'description', header: 'Description', cell: (t) => t.description ?? '' },
          ]}
          empty={<Box textAlign="center">Frank has no tools yet.</Box>}
        />
        {selected && <ToolRunner key={selected.name} tool={selected} onError={onError} />}
      </SpaceBetween>
    </ContentLayout>
  );
}

function ToolRunner({ tool, onError }: { tool: FrankTool; onError: Notify }) {
  const fields = useMemo(() => schemaToFields(tool.inputSchema), [tool]);
  const [values, setValues] = useState<FormValues>(() => initialValues(fields));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ToolResult | null>(null);

  const invoke = async () => {
    const built = buildArgs(fields, values);
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    setRunning(true);
    try {
      setResult(await callTool(tool.name, built.args));
    } catch (err) {
      onError(describeError(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Container header={<Header variant="h2" description={tool.description}>{tool.name}</Header>}>
      <SpaceBetween size="l">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void invoke();
          }}
        >
          <Form
            actions={
              <Button variant="primary" formAction="submit" loading={running}>
                Invoke
              </Button>
            }
          >
            {fields.length === 0 ? (
              <Box color="text-body-secondary">This tool takes no parameters.</Box>
            ) : (
              <SpaceBetween size="m">
                {fields.map((field) => (
                  <ParameterField
                    key={field.name}
                    field={field}
                    value={values[field.name]}
                    error={errors[field.name]}
                    onChange={(v) => setValues((current) => ({ ...current, [field.name]: v }))}
                  />
                ))}
              </SpaceBetween>
            )}
          </Form>
        </form>
        {result && <ResultView result={result} />}
      </SpaceBetween>
    </Container>
  );
}

function ParameterField({
  field,
  value,
  error,
  onChange,
}: {
  field: Field;
  value: string | boolean | undefined;
  error?: string;
  onChange: (value: string | boolean) => void;
}) {
  const label = field.required ? field.name : `${field.name} (optional)`;
  if (field.kind === 'boolean') {
    return (
      <FormField description={field.description} errorText={error}>
        <Checkbox checked={value === true} onChange={({ detail }) => onChange(detail.checked)}>
          {label}
        </Checkbox>
      </FormField>
    );
  }
  const text = typeof value === 'string' ? value : '';
  return (
    <FormField label={label} description={field.description} errorText={error}>
      {field.kind === 'enum' ? (
        <Select
          selectedOption={text ? { value: text, label: text } : null}
          options={(field.options ?? []).map((o) => ({ value: o, label: o }))}
          onChange={({ detail }) => onChange(detail.selectedOption.value ?? '')}
          placeholder="Choose a value"
        />
      ) : (
        <Input
          value={text}
          type={field.kind === 'number' || field.kind === 'integer' ? 'number' : 'text'}
          inputMode={field.kind === 'integer' ? 'numeric' : field.kind === 'number' ? 'decimal' : undefined}
          disabled={field.kind === 'unsupported'}
          onChange={({ detail }) => onChange(detail.value)}
        />
      )}
    </FormField>
  );
}

function ResultView({ result }: { result: ToolResult }) {
  if (result.isError) {
    return (
      <Alert type="error" header="The tool reported an error">
        {result.text || 'No message was returned.'}
      </Alert>
    );
  }
  return (
    <SpaceBetween size="xs">
      <Box variant="h3">Result</Box>
      <Box variant="pre" data-testid="tool-result">
        {JSON.stringify(result.data, null, 2)}
      </Box>
    </SpaceBetween>
  );
}
