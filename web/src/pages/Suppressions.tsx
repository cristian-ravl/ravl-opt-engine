import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Input,
  Option,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  Textarea,
} from '@fluentui/react-components';
import { AddRegular, DeleteRegular, EditRegular, ArrowSyncRegular } from '@fluentui/react-icons';
import { PageHeader } from '../components/PageHeader';
import { useAsync } from '../hooks/useAsync';
import { createSuppression, deleteSuppression, getSuppressions, updateSuppression } from '../services/api';
import type { Suppression } from '../services/api';
import { formatDateTimeWithRelative } from '../utils/format';
import './Suppressions.css';

const FILTER_TYPE_COLORS: Record<string, 'informative' | 'warning' | 'danger'> = {
  Dismiss: 'informative',
  Snooze: 'warning',
  Exclude: 'danger',
};

type SuppressionDraft = {
  recommendationSubTypeId: string;
  filterType: 'Dismiss' | 'Snooze' | 'Exclude';
  instanceId: string;
  filterEndDate: string;
  notes: string;
};

const EMPTY_DRAFT: SuppressionDraft = {
  recommendationSubTypeId: '',
  filterType: 'Dismiss',
  instanceId: '',
  filterEndDate: '',
  notes: '',
};

function toLocalDateTimeInput(value: string | null): string {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '';

  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

function toSuppressionDraft(suppression: Suppression): SuppressionDraft {
  return {
    recommendationSubTypeId: suppression.recommendationSubTypeId,
    filterType: suppression.filterType,
    instanceId: suppression.instanceId ?? '',
    filterEndDate: toLocalDateTimeInput(suppression.filterEndDate),
    notes: suppression.notes ?? '',
  };
}

function buildSuppressionPayload(draft: SuppressionDraft) {
  const filterEndDate = draft.filterEndDate ? new Date(draft.filterEndDate).toISOString() : null;

  return {
    recommendationSubTypeId: draft.recommendationSubTypeId.trim(),
    filterType: draft.filterType,
    instanceId: draft.instanceId.trim() || null,
    filterEndDate,
    notes: draft.notes.trim() || null,
  };
}

function getDraftValidationError(draft: SuppressionDraft): string | null {
  if (!draft.recommendationSubTypeId.trim()) {
    return 'Recommendation subtype ID is required.';
  }

  if (draft.filterType === 'Snooze') {
    if (!draft.filterEndDate) {
      return 'Snooze suppressions require an end date.';
    }

    const endDate = Date.parse(draft.filterEndDate);
    if (!Number.isFinite(endDate) || endDate <= Date.now()) {
      return 'Snooze end date must be in the future.';
    }
  }

  return null;
}

function formatEndDate(value: string | null): string {
  if (!value) return 'No end date';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

export function SuppressionsPage() {
  const suppressions = useAsync(() => getSuppressions(), []);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<SuppressionDraft>(EMPTY_DRAFT);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editingSuppression, setEditingSuppression] = useState<Suppression | null>(null);
  const [editDraft, setEditDraft] = useState<SuppressionDraft>(EMPTY_DRAFT);
  const [editError, setEditError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [suppressionToDelete, setSuppressionToDelete] = useState<Suppression | null>(null);

  const sortedSuppressions = useMemo(
    () =>
      [...(suppressions.data ?? [])].sort(
        (left, right) => Date.parse(right.filterStartDate) - Date.parse(left.filterStartDate),
      ),
    [suppressions.data],
  );

  const handleCreate = async () => {
    const validationError = getDraftValidationError(createDraft);
    if (validationError) {
      setCreateError(validationError);
      return;
    }

    try {
      setCreateError(null);
      setActionError(null);
      await createSuppression(buildSuppressionPayload(createDraft));
      setCreateDraft(EMPTY_DRAFT);
      setIsCreateDialogOpen(false);
      suppressions.refresh();
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleStartEdit = (suppression: Suppression) => {
    setEditingSuppression(suppression);
    setEditDraft(toSuppressionDraft(suppression));
    setEditError(null);
    setActionError(null);
  };

  const handleUpdate = async () => {
    if (!editingSuppression) return;

    const validationError = getDraftValidationError(editDraft);
    if (validationError) {
      setEditError(validationError);
      return;
    }

    try {
      setEditError(null);
      setActionError(null);
      await updateSuppression(editingSuppression.filterId, buildSuppressionPayload(editDraft));
      setEditingSuppression(null);
      setEditDraft(EMPTY_DRAFT);
      suppressions.refresh();
    } catch (error) {
      setEditError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleDelete = async (filterId: string) => {
    try {
      setActionError(null);
      await deleteSuppression(filterId);
      setSuppressionToDelete(null);
      suppressions.refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  };

  const dismissCount = sortedSuppressions.filter((suppression) => suppression.filterType === 'Dismiss').length;
  const snoozeCount = sortedSuppressions.filter((suppression) => suppression.filterType === 'Snooze').length;
  const excludeCount = sortedSuppressions.filter((suppression) => suppression.filterType === 'Exclude').length;

  if (suppressions.loading) {
    return <Spinner label="Loading suppressions..." />;
  }

  if (suppressions.error) {
    return <Text className="suppressionsPage__errorText">Error loading suppressions: {suppressions.error.message}</Text>;
  }

  return (
    <div className="suppressionsPage">
      <PageHeader
        eyebrow="Governance"
        title="Suppressions"
        description="Manage dismissals, snoozes, and exclusions so the review queue stays useful without losing the audit trail behind each decision."
        meta={<Text size={200} className="suppressionsPage__mutedText">{sortedSuppressions.length} active suppressions</Text>}
        actions={
          <>
            <Button icon={<AddRegular />} appearance="primary" onClick={() => setIsCreateDialogOpen(true)}>
              New suppression
            </Button>
            <Button icon={<ArrowSyncRegular />} appearance="secondary" onClick={() => suppressions.refresh()}>
              Refresh
            </Button>
          </>
        }
      />

      <div className="suppressionsPage__summaryGrid">
        <Card size="small">
          <CardHeader header={<Text weight="semibold">Dismissed</Text>} description={<Text size={700}>{dismissCount}</Text>} />
        </Card>
        <Card size="small">
          <CardHeader header={<Text weight="semibold">Snoozed</Text>} description={<Text size={700}>{snoozeCount}</Text>} />
        </Card>
        <Card size="small">
          <CardHeader header={<Text weight="semibold">Excluded</Text>} description={<Text size={700}>{excludeCount}</Text>} />
        </Card>
      </div>

      {actionError && <Text className="suppressionsPage__errorText">{actionError}</Text>}

      <Dialog
        open={isCreateDialogOpen}
        onOpenChange={(_, data) => {
          setIsCreateDialogOpen(data.open);
          if (!data.open) {
            setCreateDraft(EMPTY_DRAFT);
            setCreateError(null);
          }
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Create suppression</DialogTitle>
            <DialogContent>
              <div className="suppressionsPage__formGrid">
                <div className="suppressionsPage__fieldGroup">
                  <Text size={200} className="suppressionsPage__fieldLabel">
                    Recommendation subtype ID *
                  </Text>
                  <Input
                    value={createDraft.recommendationSubTypeId}
                    onChange={(_, data) => setCreateDraft((current) => ({ ...current, recommendationSubTypeId: data.value }))}
                    placeholder="GUID of the recommendation subtype"
                    className="suppressionsPage__input"
                  />
                </div>

                <div className="suppressionsPage__fieldGroup">
                  <Text size={200} className="suppressionsPage__fieldLabel">
                    Filter type
                  </Text>
                  <Dropdown
                    value={createDraft.filterType}
                    selectedOptions={[createDraft.filterType]}
                    onOptionSelect={(_, data) =>
                      setCreateDraft((current) => ({
                        ...current,
                        filterType: (data.optionValue as SuppressionDraft['filterType']) ?? 'Dismiss',
                        filterEndDate:
                          (data.optionValue as SuppressionDraft['filterType']) === 'Snooze' ? current.filterEndDate : '',
                      }))
                    }
                  >
                    <Option value="Dismiss" text="Dismiss">
                      Dismiss
                    </Option>
                    <Option value="Snooze" text="Snooze">
                      Snooze
                    </Option>
                    <Option value="Exclude" text="Exclude">
                      Exclude
                    </Option>
                  </Dropdown>
                </div>

                {createDraft.filterType === 'Snooze' && (
                  <div className="suppressionsPage__fieldGroup">
                    <Text size={200} className="suppressionsPage__fieldLabel">
                      Snooze until *
                    </Text>
                    <Input
                      type="datetime-local"
                      value={createDraft.filterEndDate}
                      onChange={(_, data) => setCreateDraft((current) => ({ ...current, filterEndDate: data.value }))}
                      className="suppressionsPage__input"
                    />
                  </div>
                )}

                <div className="suppressionsPage__fieldGroup">
                  <Text size={200} className="suppressionsPage__fieldLabel">
                    Instance ID
                  </Text>
                  <Input
                    value={createDraft.instanceId}
                    onChange={(_, data) => setCreateDraft((current) => ({ ...current, instanceId: data.value }))}
                    placeholder="Leave empty to suppress all matching instances"
                    className="suppressionsPage__input"
                  />
                </div>

                <div className="suppressionsPage__fieldGroup">
                  <Text size={200} className="suppressionsPage__fieldLabel">
                    Notes
                  </Text>
                  <Textarea
                    value={createDraft.notes}
                    onChange={(_, data) => setCreateDraft((current) => ({ ...current, notes: data.value }))}
                    placeholder="Why is this being suppressed?"
                    className="suppressionsPage__input"
                  />
                </div>

                {createError && <Text className="suppressionsPage__errorText">{createError}</Text>}
              </div>
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setIsCreateDialogOpen(false)}>
                Cancel
              </Button>
              <Button appearance="primary" onClick={handleCreate}>
                Create
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <Dialog
        open={editingSuppression !== null}
        onOpenChange={(_, data) => {
          if (!data.open) {
            setEditingSuppression(null);
            setEditDraft(EMPTY_DRAFT);
            setEditError(null);
          }
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Edit suppression</DialogTitle>
            <DialogContent>
              <div className="suppressionsPage__formGrid">
                <div className="suppressionsPage__fieldGroup">
                  <Text size={200} className="suppressionsPage__fieldLabel">
                    Recommendation subtype ID *
                  </Text>
                  <Input
                    value={editDraft.recommendationSubTypeId}
                    onChange={(_, data) => setEditDraft((current) => ({ ...current, recommendationSubTypeId: data.value }))}
                    className="suppressionsPage__input"
                  />
                </div>

                <div className="suppressionsPage__fieldGroup">
                  <Text size={200} className="suppressionsPage__fieldLabel">
                    Filter type
                  </Text>
                  <Dropdown
                    value={editDraft.filterType}
                    selectedOptions={[editDraft.filterType]}
                    onOptionSelect={(_, data) =>
                      setEditDraft((current) => ({
                        ...current,
                        filterType: (data.optionValue as SuppressionDraft['filterType']) ?? 'Dismiss',
                        filterEndDate:
                          (data.optionValue as SuppressionDraft['filterType']) === 'Snooze' ? current.filterEndDate : '',
                      }))
                    }
                  >
                    <Option value="Dismiss" text="Dismiss">
                      Dismiss
                    </Option>
                    <Option value="Snooze" text="Snooze">
                      Snooze
                    </Option>
                    <Option value="Exclude" text="Exclude">
                      Exclude
                    </Option>
                  </Dropdown>
                </div>

                {editDraft.filterType === 'Snooze' && (
                  <div className="suppressionsPage__fieldGroup">
                    <Text size={200} className="suppressionsPage__fieldLabel">
                      Snooze until *
                    </Text>
                    <Input
                      type="datetime-local"
                      value={editDraft.filterEndDate}
                      onChange={(_, data) => setEditDraft((current) => ({ ...current, filterEndDate: data.value }))}
                      className="suppressionsPage__input"
                    />
                  </div>
                )}

                <div className="suppressionsPage__fieldGroup">
                  <Text size={200} className="suppressionsPage__fieldLabel">
                    Instance ID
                  </Text>
                  <Input
                    value={editDraft.instanceId}
                    onChange={(_, data) => setEditDraft((current) => ({ ...current, instanceId: data.value }))}
                    className="suppressionsPage__input"
                  />
                </div>

                <div className="suppressionsPage__fieldGroup">
                  <Text size={200} className="suppressionsPage__fieldLabel">
                    Notes
                  </Text>
                  <Textarea
                    value={editDraft.notes}
                    onChange={(_, data) => setEditDraft((current) => ({ ...current, notes: data.value }))}
                    className="suppressionsPage__input"
                  />
                </div>

                {editError && <Text className="suppressionsPage__errorText">{editError}</Text>}
              </div>
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setEditingSuppression(null)}>
                Cancel
              </Button>
              <Button appearance="primary" onClick={handleUpdate}>
                Save
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <Dialog open={suppressionToDelete !== null} onOpenChange={(_, data) => !data.open && setSuppressionToDelete(null)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Delete suppression</DialogTitle>
            <DialogContent>
              <Text>
                Remove this suppression and allow matching recommendations to appear again?
              </Text>
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setSuppressionToDelete(null)}>
                Cancel
              </Button>
              <Button appearance="primary" icon={<DeleteRegular />} onClick={() => suppressionToDelete && handleDelete(suppressionToDelete.filterId)}>
                Delete suppression
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <Card>
        <CardHeader
          header={<Text weight="semibold">Active suppressions</Text>}
          description={<Text size={200}>Suppressions remain auditable and can target one instance or every matching instance.</Text>}
        />

        {sortedSuppressions.length === 0 ? (
          <div className="suppressionsPage__emptyState">
            <Text className="suppressionsPage__mutedText">No active suppressions yet. Create one when you need to dismiss, snooze, or exclude noisy recommendations.</Text>
          </div>
        ) : (
          <div className="suppressionsPage__tableWrap">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Type</TableHeaderCell>
                  <TableHeaderCell>Subtype ID</TableHeaderCell>
                  <TableHeaderCell>Scope</TableHeaderCell>
                  <TableHeaderCell>Created</TableHeaderCell>
                  <TableHeaderCell>Ends</TableHeaderCell>
                  <TableHeaderCell>Notes</TableHeaderCell>
                  <TableHeaderCell>Actions</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedSuppressions.map((suppression) => (
                  <TableRow key={suppression.filterId}>
                    <TableCell>
                      <Badge color={FILTER_TYPE_COLORS[suppression.filterType] ?? 'informative'} size="small">
                        {suppression.filterType}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Text size={200} font="monospace">
                        {suppression.recommendationSubTypeId}
                      </Text>
                    </TableCell>
                    <TableCell>
                      <Text size={200}>{suppression.instanceId ?? 'All matching instances'}</Text>
                    </TableCell>
                    <TableCell>
                      <Text size={200}>{formatDateTimeWithRelative(suppression.filterStartDate)}</Text>
                    </TableCell>
                    <TableCell>
                      <Text size={200}>{suppression.filterEndDate ? formatDateTimeWithRelative(suppression.filterEndDate) : formatEndDate(suppression.filterEndDate)}</Text>
                    </TableCell>
                    <TableCell>
                      <Text size={200}>{suppression.notes ?? '—'}</Text>
                    </TableCell>
                    <TableCell>
                      <div className="suppressionsPage__rowActions">
                        <Button icon={<EditRegular />} appearance="subtle" size="small" onClick={() => handleStartEdit(suppression)} title="Edit suppression" />
                        <Button icon={<DeleteRegular />} appearance="subtle" size="small" onClick={() => setSuppressionToDelete(suppression)} title="Delete suppression" />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
