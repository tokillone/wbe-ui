import type { MapBiomarkerOption, MapBiomarkerPath, MapFilterSelection } from '../types/map'

export type BiomarkerFilterOption = {
  value: string
  label: string
  description?: string
  searchText?: string
  meta?: string
  levelLabel?: string
}

export type MapFilterSearchOption = BiomarkerFilterOption & {
  selection: MapFilterSelection
}

export type MapFilterSearchLabels = {
  targetClass: string
  category: string
  subcategory: string
  biomarker: string
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
  allSubcategory = '全部小类',
): BiomarkerFilterOption[] {
  if (!Array.isArray(paths)) {
    return legacyOptions.map((option) => ({
      value: option.key,
      label: formatLabel(option.label),
      searchText: [option.key, option.cas].filter(Boolean).join(' '),
      meta: option.cas || undefined,
    }))
  }
  return [
    { value: ALL_BIOMARKER_PATH_KEY, label: allLabel },
    ...deduplicateBiomarkerPaths(paths, allSubcategory).map((path) => ({
      value: biomarkerPathKey(path),
      label: formatLabel(path.biomarkerLabel || path.biomarkerKey),
      description: biomarkerPathDescription(path),
      searchText: biomarkerPathSearchText(path),
      meta: path.biomarkerCas || undefined,
    })),
  ]
}

export function deduplicateBiomarkerPaths(
  paths: MapBiomarkerPath[],
  allSubcategory: string,
): MapBiomarkerPath[] {
  const groups = new Map<string, MapBiomarkerPath[]>()
  paths.forEach((path) => {
    const groupKey = [path.targetClass, path.category, path.biomarkerKey].join('|||')
    const group = groups.get(groupKey) ?? []
    group.push(path)
    groups.set(groupKey, group)
  })

  const result: MapBiomarkerPath[] = []
  groups.forEach((group) => {
    const specificPaths = group.filter((path) => path.subcategory !== allSubcategory)
    const preferredPaths = specificPaths.length ? specificPaths : group
    const seenPaths = new Set<string>()
    preferredPaths.forEach((path) => {
      const pathKey = biomarkerPathKey(path)
      if (seenPaths.has(pathKey)) return
      seenPaths.add(pathKey)
      result.push(path)
    })
  })
  return result
}

export function mapFilterSearchOptions(
  paths: MapBiomarkerPath[],
  defaults: CategorySelectionDefaults,
  labels: MapFilterSearchLabels,
  formatLabel: (value: string) => string = (value) => value,
): MapFilterSearchOption[] {
  const targetClasses = new Map<string, MapFilterSearchOption>()
  const categories = new Map<string, MapFilterSearchOption>()
  const subcategories = new Map<string, MapFilterSearchOption>()

  paths.forEach((path) => {
    const targetKey = `targetClass|||${path.targetClass}`
    if (!targetClasses.has(targetKey)) {
      targetClasses.set(targetKey, {
        value: targetKey,
        label: formatLabel(path.targetClass),
        levelLabel: labels.targetClass,
        searchText: path.targetClass,
        selection: {
          targetClass: path.targetClass,
          category: defaults.allCategory,
          subcategory: defaults.allSubcategory,
          biomarkerKey: defaults.allBiomarker,
          year: defaults.allYear,
        },
      })
    }

    const categoryKey = `category|||${path.targetClass}|||${path.category}`
    if (!categories.has(categoryKey)) {
      categories.set(categoryKey, {
        value: categoryKey,
        label: formatLabel(path.category),
        description: formatLabel(path.targetClass),
        levelLabel: labels.category,
        searchText: path.category,
        selection: {
          targetClass: path.targetClass,
          category: path.category,
          subcategory: defaults.allSubcategory,
          biomarkerKey: defaults.allBiomarker,
          year: defaults.allYear,
        },
      })
    }

    if (path.subcategory && path.subcategory !== defaults.allSubcategory) {
      const subcategoryKey = `subcategory|||${path.targetClass}|||${path.category}|||${path.subcategory}`
      if (!subcategories.has(subcategoryKey)) {
        subcategories.set(subcategoryKey, {
          value: subcategoryKey,
          label: formatLabel(path.subcategory),
          description: [path.targetClass, path.category].map(formatLabel).join(' › '),
          levelLabel: labels.subcategory,
          searchText: path.subcategory,
          selection: {
            targetClass: path.targetClass,
            category: path.category,
            subcategory: path.subcategory,
            biomarkerKey: defaults.allBiomarker,
            year: defaults.allYear,
          },
        })
      }
    }
  })

  const biomarkers: MapFilterSearchOption[] = deduplicateBiomarkerPaths(
    paths,
    defaults.allSubcategory,
  ).map((path) => {
    const pathKey = biomarkerPathKey(path)
    return {
      value: `biomarker|||${pathKey}`,
      label: formatLabel(path.biomarkerLabel || path.biomarkerKey),
      description: biomarkerPathDescription(path).split(' › ').map(formatLabel).join(' › '),
      levelLabel: labels.biomarker,
      searchText: [path.biomarkerLabel, path.biomarkerKey, path.biomarkerCas]
        .filter(Boolean)
        .join(' '),
      meta: path.biomarkerCas || undefined,
      selection: {
        targetClass: path.targetClass,
        category: path.category,
        subcategory: path.subcategory,
        biomarkerKey: path.biomarkerKey,
        year: defaults.allYear,
      },
    }
  })

  return [
    ...targetClasses.values(),
    ...categories.values(),
    ...subcategories.values(),
    ...biomarkers,
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
