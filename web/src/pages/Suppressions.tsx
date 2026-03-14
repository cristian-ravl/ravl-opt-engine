// Suppressions page — manage recommendation suppressions (dismiss, snooze, exclude)

import { useState } from 'react';
import {
  Table,
  TableHeader,
  TableHeaderCell,
  TableBody,
  TableRow,
  TableCell,
  Badge,
  Button,
  Spinner,
  Text,
  Input,
  Dropdown,
  Option,
  Dialog,
  DialogTrigger,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogActions,
  Textarea,
} from '@fluentui/react-components';
import { AddRegular, DeleteRegular } from '@fluentui/react-icons';
import { useAsync } from '../hooks/useAsync';
import { getSuppressions, createSuppression, deleteSuppression } from '../services/api';

const FILTER_TYPE_COLORS: Record<string, 'informative' | 'warning' | 'danger'> = {
  Dismiss: 'informative',
  Snooze: 'warning',
  Exclude: 'danger',
};

export function SuppressionsPage() {
  const suppressions = useAsync(() => getSuppressions(), []);
  const [newSuppression, setNewSuppression] = useState({
    recommendationSubTypeId: '',
    filterType: 'Dismiss' as 'Dismiss' | 'Snooze' | 'Exclude',
    instanceId: '',
    notes: '',
  });

  const handleCreate = async () => {
    if (!newSuppression.recommendationSubTypeId) return;
    await createSuppression({
      recommendationSubTypeId: newSuppression.recommendationSubTypeId,
      filterType: newSuppression.filterType,
      instanceId: newSuppression.instanceId || null,
      notes: newSuppression.notes || null,
    });
    setNewSuppression({ recommendationSubTypeId: '', filterType: 'Dismiss', instanceId: '', notes: '' });
    suppressions.refresh();
  };

  const handleDelete = async (filterId: string) => {
    await deleteSuppression(filterId);
    suppressions.refresh();
  };

  if (suppressions.loading) {
    return <Spinner label="Loading suppressions..." />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Create new suppression */}
      <Dialog>
        <DialogTrigger disableButtonEnhancement>
          <Button icon={<AddRegular />} appearance="primary">
            New suppression
          </Button>
        </DialogTrigger>
        <DialogSurface>
          <DialogTitle>Create suppression</DialogTitle>
          <DialogBody>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <Text size={200} style={{ display: 'block', marginBottom: 4 }}>
                  Recommendation subtype ID *
                </Text>
                <Input
                  value={newSuppression.recommendationSubTypeId}
                  onChange={(_, data) => setNewSuppression((s) => ({ ...s, recommendationSubTypeId: data.value }))}
                  placeholder="GUID of the recommendation subtype"
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <Text size={200} style={{ display: 'block', marginBottom: 4 }}>
                  Filter type
                </Text>
                <Dropdown
                  value={newSuppression.filterType}
                  onOptionSelect={(_, data) =>
                    setNewSuppression((s) => ({
                      ...s,
                      filterType: (data.optionValue as 'Dismiss' | 'Snooze' | 'Exclude') ?? 'Dismiss',
                    }))
                  }
                >
                  <Option value="Dismiss">Dismiss</Option>
                  <Option value="Snooze">Snooze</Option>
                  <Option value="Exclude">Exclude</Option>
                </Dropdown>
              </div>
              <div>
                <Text size={200} style={{ display: 'block', marginBottom: 4 }}>
                  Instance ID (optional — leave empty to suppress all instances)
                </Text>
                <Input
                  value={newSuppression.instanceId}
                  onChange={(_, data) => setNewSuppression((s) => ({ ...s, instanceId: data.value }))}
                  placeholder="/subscriptions/..."
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <Text size={200} style={{ display: 'block', marginBottom: 4 }}>
                  Notes
                </Text>
                <Textarea
                  value={newSuppression.notes}
                  onChange={(_, data) => setNewSuppression((s) => ({ ...s, notes: data.value }))}
                  placeholder="Why is this being suppressed?"
                  style={{ width: '100%' }}
                />
              </div>
            </div>
          </DialogBody>
          <DialogActions>
            <DialogTrigger disableButtonEnhancement>
              <Button appearance="secondary">Cancel</Button>
            </DialogTrigger>
            <Button appearance="primary" onClick={handleCreate}>
              Create
            </Button>
          </DialogActions>
        </DialogSurface>
      </Dialog>

      {/* Suppressions table */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHeaderCell style={{ width: 100 }}>Type</TableHeaderCell>
            <TableHeaderCell style={{ width: 300 }}>Subtype ID</TableHeaderCell>
            <TableHeaderCell>Instance</TableHeaderCell>
            <TableHeaderCell style={{ width: 180 }}>Start date</TableHeaderCell>
            <TableHeaderCell>Notes</TableHeaderCell>
            <TableHeaderCell style={{ width: 80 }}>Actions</TableHeaderCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(suppressions.data ?? []).map((s) => (
            <TableRow key={s.filterId}>
              <TableCell>
                <Badge color={FILTER_TYPE_COLORS[s.filterType] ?? 'informative'} size="small">
                  {s.filterType}
                </Badge>
              </TableCell>
              <TableCell>
                <Text size={200} font="monospace">
                  {s.recommendationSubTypeId}
                </Text>
              </TableCell>
              <TableCell>
                <Text size={200}>{s.instanceId ?? 'All instances'}</Text>
              </TableCell>
              <TableCell>
                <Text size={200}>{new Date(s.filterStartDate).toLocaleDateString()}</Text>
              </TableCell>
              <TableCell>
                <Text size={200}>{s.notes ?? ''}</Text>
              </TableCell>
              <TableCell>
                <Button icon={<DeleteRegular />} appearance="subtle" size="small" onClick={() => handleDelete(s.filterId)} title="Delete" />
              </TableCell>
            </TableRow>
          ))}
          {(suppressions.data ?? []).length === 0 && (
            <TableRow>
              <TableCell colSpan={6}>
                <Text style={{ color: '#666', fontStyle: 'italic' }}>No active suppressions</Text>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
