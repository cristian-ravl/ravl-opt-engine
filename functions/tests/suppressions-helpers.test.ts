import { describe, expect, it } from 'vitest';
import {
  buildActiveSuppressionsKql,
  buildActiveSuppressionsSourceKql,
  buildSuppressionByIdKql,
  createSuppressionRecord,
  disableSuppressionRecord,
  toSuppression,
  updateSuppressionRecord,
} from '../src/api/suppressions-helpers.js';
import type { Suppression } from '../src/providers/types.js';

const NOW_ISO = '2026-03-14T12:00:00.000Z';

const baseSuppression: Suppression = {
  filterId: '4c2da660-f47b-43ec-9f86-2a1194bd22b4',
  recommendationSubTypeId: '110fea55-a9c3-480d-8248-116f61e139a8',
  filterType: 'Dismiss',
  instanceId: '/subscriptions/abc/resourcegroups/rg/providers/microsoft.compute/virtualmachines/vm1',
  filterStartDate: '2026-03-10T08:00:00.000Z',
  filterEndDate: null,
  author: null,
  notes: 'Keep hidden',
  isEnabled: true,
};

describe('suppression helpers', () => {
  it('builds active-suppression queries from the latest version per filter', () => {
    const sourceKql = buildActiveSuppressionsSourceKql();
    const filteredKql = buildActiveSuppressionsKql({
      subTypeId: baseSuppression.recommendationSubTypeId,
      filterType: 'Dismiss',
    });

    expect(sourceKql).toContain('ActiveSuppressions');
    expect(sourceKql).toContain('| where IsEnabled == true');
    expect(sourceKql).toContain('| where FilterStartDate <= now()');
    expect(sourceKql).toContain('| where isnull(FilterEndDate) or FilterEndDate > now()');

    expect(filteredKql).toContain(`tostring(RecommendationSubTypeId) == "${baseSuppression.recommendationSubTypeId}"`);
    expect(filteredKql).toContain('FilterType == "Dismiss"');
    expect(buildSuppressionByIdKql(baseSuppression.filterId)).toContain(`tostring(FilterId) == "${baseSuppression.filterId}"`);
  });

  it('maps ADX rows to the API suppression shape', () => {
    expect(
      toSuppression({
        FilterId: baseSuppression.filterId,
        RecommendationSubTypeId: baseSuppression.recommendationSubTypeId.toUpperCase(),
        FilterType: 'Dismiss',
        InstanceId: baseSuppression.instanceId,
        FilterStartDate: baseSuppression.filterStartDate,
        FilterEndDate: null,
        Author: 'alice',
        Notes: 'test',
        IsEnabled: true,
      }),
    ).toEqual({
      ...baseSuppression,
      recommendationSubTypeId: baseSuppression.recommendationSubTypeId.toUpperCase(),
      author: 'alice',
      notes: 'test',
    });
  });

  it('validates create payloads and requires snooze end dates', () => {
    expect(
      createSuppressionRecord(
        {
          recommendationSubTypeId: baseSuppression.recommendationSubTypeId,
          filterType: 'Snooze',
        },
        baseSuppression.filterId,
        NOW_ISO,
      ),
    ).toEqual({
      error: 'filterEndDate is required for Snooze suppressions',
    });

    expect(
      createSuppressionRecord(
        {
          recommendationSubTypeId: baseSuppression.recommendationSubTypeId,
          filterType: 'Dismiss',
          instanceId: baseSuppression.instanceId?.toUpperCase(),
          notes: '  keep hidden  ',
        },
        baseSuppression.filterId,
        NOW_ISO,
      ),
    ).toEqual({
      suppression: {
        ...baseSuppression,
        filterStartDate: NOW_ISO,
        instanceId: baseSuppression.instanceId,
        notes: 'keep hidden',
      },
    });
  });

  it('merges updates on top of the current suppression and versions deletes', () => {
    const updated = updateSuppressionRecord(
      baseSuppression,
      {
        filterType: 'Snooze',
        filterEndDate: '2026-03-20T08:00:00.000Z',
        notes: '',
      },
      NOW_ISO,
    );

    expect(updated).toEqual({
      suppression: {
        ...baseSuppression,
        filterType: 'Snooze',
        filterStartDate: NOW_ISO,
        filterEndDate: '2026-03-20T08:00:00.000Z',
        notes: null,
      },
    });

    expect(disableSuppressionRecord(baseSuppression, NOW_ISO)).toEqual({
      ...baseSuppression,
      filterStartDate: NOW_ISO,
      isEnabled: false,
    });
  });
});
