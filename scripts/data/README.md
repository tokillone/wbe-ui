# Boundary source notes

`china-land-detail.geojson` is a build-time-only land geometry extracted from
Natural Earth 1:10m Admin 0 Countries v5.1.1. The CHN, HKG, MAC and TWN records
were dissolved into one display geometry and rounded to six decimal places.

Natural Earth data is public domain:
https://www.naturalearthdata.com/about/terms-of-use/

Source download:
https://naturalearth.s3.amazonaws.com/10m_cultural/ne_10m_admin_0_countries.zip

The global city-equivalent PMTiles layer uses the geoBoundaries Comprehensive
Global Administrative Zones (CGAZ) ADM1 and ADM2 archives. Downloads are pinned
by commit in `../prepare-global-admin2.mjs`; the generated report records SHA-256
hashes. CGAZ is used because its global composite is simplified and gap-filled,
which is appropriate for a seamless application map.

geoBoundaries data is CC BY 4.0 and requires attribution:
https://www.geoboundaries.org/
