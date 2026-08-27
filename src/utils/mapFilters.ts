import type { MapBiomarkerOption, MapBiomarkerPath, MapFilterSelection } from '../types/map'

export type BiomarkerFilterOption = {
  value: string
  label: string
  description?: string
  searchText?: string
}

export const ALL_BIOMARKER_PATH_KEY = 'ALL'

export type CategorySelectionDefaults = {
  allCategory: string
  allSubcategory: string
  allBiomarker: string
  allYear: string
}

export function biomarkerPathKey(path: MapBiomarkerPath) {
  return [path.targetClass, path.category, path.subcategory, path.biomarkerKey].join('|||')
}

export function biomarkerPathDescription(path: MapBiomarkerPath) {
  return [path.targetClass, path.category, path.subcategory].filter(Boolean).join(' › ')
}

export function biomarkerPathSearchText(path: MapBiomarkerPath) {
  return [
    path.biomarkerLabel,
    path.biomarkerKey,
    path.biomarkerCas,
    path.targetClass,
    path.category,
    path.subcategory,
  ]
    .filter(Boolean)
    .join(' ')
}

export function biomarkerFilterOptions(
  paths: MapBiomarkerPath[] | undefined,
  legacyOptions: MapBiomarkerOption[],
  allLabel: string,
  formatLabel: (value: string) => string = (value) => value,
): BiomarkerFilterOption[] {
  if (!Array.isArray(paths)) {
    return legacyOptions.map((option) => ({
      value: option.key,
      label: formatLabel(option.label),
      searchText: [option.key, option.cas].filter(Boolean).join(' '),
    }))
  }
  return [
    { value: ALL_BIOMARKER_PATH_KEY, label: allLabel },
    ...paths.map((path) => ({
      value: biomarkerPathKey(path),
      label: formatLabel(path.biomarkerLabel || path.biomarkerKey),
      description: biomarkerPathDescription(path),
      searchText: biomarkerPathSearchText(path),
    })),
  ]
}

export function selectionForBiomarkerPath(
  selection: MapFilterSelection,
  path: MapBiomarkerPath,
  allYearLabel: string,
): MapFilterSelection {
  return {
    ...selection,
    targetClass: path.targetClass,
    category: path.category,
    subcategory: path.subcategory,
    biomarkerKey: path.biomarkerKey,
    year: allYearLabel,
  }
}

export function selectionForCategory(
  selection: MapFilterSelection,
  category: string,
  categoriesByTargetClass: Record<string, string[]>,
  defaults: CategorySelectionDefaults,
): MapFilterSelection | null {
  if (category === defaults.allCategory) {
    return {
      ...selection,
      category,
      subcategory: defaults.allSubcategory,
      biomarkerKey: defaults.allBiomarker,
      year: defaults.allYear,
    }
  }

  const parentTargetClasses = Object.entries(categoriesByTargetClass)
    .filter(([, categories]) => categories.includes(category))
    .map(([targetClass]) => targetClass)
  if (parentTargetClasses.length !== 1) return null

  return {
    ...selection,
    targetClass: parentTargetClasses[0]!,
    category,
    subcategory: defaults.allSubcategory,
    biomarkerKey: defaults.allBiomarker,
    year: defaults.allYear,
  }
}

export function selectionForAllBiomarkers(
  selection: MapFilterSelection,
  allYearLabel: string,
): MapFilterSelection {
  return {
    ...selection,
    biomarkerKey: ALL_BIOMARKER_PATH_KEY,
    year: allYearLabel,
  }
}
