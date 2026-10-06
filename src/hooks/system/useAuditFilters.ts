// 筛选草稿与已生效条件分开：半截时间和倒置范围不改变正在展示的结果。
import { useCallback, useMemo, useRef, useState, type RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { auditEmptyKind, describeAuditFilters, localInputToIso } from '@/lib/audit/auditStream';
import { getSandbox } from '@/services/api/sandbox.service';
import type { AuditCategory, AuditEmptyKind, AuditFilters } from '@/types/audit';

type TimeField = 'from' | 'to';
interface FilterState {
  category: AuditCategory | undefined;
  alertsOnly: boolean;
  fromLocal: string;
  toLocal: string;
  subjectId: string | undefined;
  subjectName: string | undefined;
  filters: AuditFilters;
  timeErrorField: TimeField | undefined;
}
function initialState(subjectId?: string): FilterState {
  return {
    category: undefined,
    alertsOnly: false,
    fromLocal: '',
    toLocal: '',
    subjectId,
    subjectName: undefined,
    filters: subjectId === undefined ? {} : { subjectId },
    timeErrorField: undefined,
  };
}
function applyDraft(prev: FilterState, draft: FilterState, edited?: TimeField): FilterState {
  const from = localInputToIso(draft.fromLocal);
  const to = localInputToIso(draft.toLocal);
  if (from !== undefined && to !== undefined && from > to) {
    return {
      ...draft,
      filters: prev.filters,
      timeErrorField: edited ?? prev.timeErrorField ?? 'to',
    };
  }
  // 用户还没填完一格时保留上一次条件，不把一半输入解释成清空。
  if (
    (draft.fromLocal !== '' && from === undefined) ||
    (draft.toLocal !== '' && to === undefined)
  ) {
    return { ...draft, filters: prev.filters, timeErrorField: undefined };
  }
  return {
    ...draft,
    timeErrorField: undefined,
    filters: {
      ...(draft.category === undefined ? {} : { category: draft.category }),
      ...(draft.alertsOnly ? { severity: 'warn-and-error' as const } : {}),
      ...(draft.subjectId === undefined ? {} : { subjectId: draft.subjectId }),
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
    },
  };
}
export interface UseAuditFiltersResult {
  categoryRef: RefObject<HTMLSelectElement | null>;
  filters: AuditFilters;
  category: AuditCategory | undefined;
  alertsOnly: boolean;
  fromLocal: string;
  toLocal: string;
  emptyKind: AuditEmptyKind;
  filterSummary: string;
  subjectName: string | undefined;
  timeErrorField: TimeField | undefined;
  timeError: string | null;
  setCategory: (next: AuditCategory | undefined) => void;
  setAlertsOnly: (next: boolean) => void;
  setFromLocal: (next: string) => void;
  setToLocal: (next: string) => void;
  setSubjectId: (next: string | undefined, name?: string) => void;
  clear: () => void;
}
export function useAuditFilters(initialSubjectId?: string): UseAuditFiltersResult {
  const [state, setState] = useState(() => initialState(initialSubjectId));
  const categoryRef = useRef<HTMLSelectElement>(null);
  // 历史状态事件可能没有任务名称快照；现存任务按真实 DTO 补名，读不到时保留 ID。
  const subject = useQuery({
    queryKey: ['sandbox', state.subjectId],
    queryFn: () => getSandbox(state.subjectId ?? ''),
    enabled: state.subjectId !== undefined && state.subjectName === undefined,
    retry: false,
  });
  const subjectName =
    state.subjectId === undefined
      ? undefined
      : (state.subjectName ?? subject.data?.name ?? state.subjectId.slice(0, 8));
  const setCategory = useCallback((category: AuditCategory | undefined) => {
    setState((prev) => applyDraft(prev, { ...prev, category }));
  }, []);
  const setAlertsOnly = useCallback((alertsOnly: boolean) => {
    setState((prev) => applyDraft(prev, { ...prev, alertsOnly }));
  }, []);
  const setFromLocal = useCallback((fromLocal: string) => {
    setState((prev) => applyDraft(prev, { ...prev, fromLocal }, 'from'));
  }, []);
  const setToLocal = useCallback((toLocal: string) => {
    setState((prev) => applyDraft(prev, { ...prev, toLocal }, 'to'));
  }, []);
  const setSubjectId = useCallback((subjectId: string | undefined, name?: string) => {
    setState({ ...initialState(subjectId), subjectName: name });
  }, []);
  const clear = useCallback(() => {
    setState(initialState());
    categoryRef.current?.focus();
  }, []);
  const filterSummary = useMemo(
    () => describeAuditFilters(state.filters, Date.now(), subjectName),
    [state.filters, subjectName],
  );
  return {
    categoryRef,
    ...state,
    subjectName,
    emptyKind: auditEmptyKind(state.filters),
    filterSummary,
    timeError:
      state.timeErrorField === undefined
        ? null
        : `${state.timeErrorField === 'from' ? '「起」晚于「止」' : '「止」早于「起」'}：这组时间没有生效，下面仍是上一次的筛选结果。`,
    setCategory,
    setAlertsOnly,
    setFromLocal,
    setToLocal,
    setSubjectId,
    clear,
  };
}
