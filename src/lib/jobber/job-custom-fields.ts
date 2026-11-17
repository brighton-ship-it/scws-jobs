/**
 * Read-only Jobber job custom fields. Values ride on Job.customFields with the Jobs read
 * scope this app already has. Custom Field Configurations is only for creating fields.
 * Nothing here writes to Jobber.
 */

export const JOB_TRUE_FALSE_FIELDS =
  'customFields { __typename ... on CustomFieldTrueFalse { label valueTrueFalse } }';

export interface JobTrueFalseField {
  __typename?: string | null;
  label?: string | null;
  valueTrueFalse?: boolean | null;
}

/** True when Jobber rejected the custom-field selection (unknown field or hidden type). */
export function customFieldSelectionRejected(message: string | null | undefined): boolean {
  return /customField/i.test(message ?? '');
}

/**
 * Callback true/false on one job.
 * null = custom fields were not in this payload (do not treat the job as a first-time fix).
 * false = fields were loaded and Callback is not true (missing label counts as not marked).
 */
export function callbackMarked(fields: Array<JobTrueFalseField | null> | null | undefined): boolean | null {
  if (!Array.isArray(fields)) return null;
  for (const field of fields) {
    if (!field || typeof field !== 'object') continue;
    if (String(field.label ?? '').trim().toLowerCase() !== 'callback') continue;
    return field.valueTrueFalse === true;
  }
  return false;
}
