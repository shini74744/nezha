# Carrier catalog and custom routes
First curated catalog: 35 brand logos, not an exhaustive list of worldwide operators.
Country/region selector uses the i18n-iso-countries ISO-code dataset (MIT, plus its XK entry); names are localized with Intl.DisplayNames.
Regions group brands by home market; INT is an additional international backbone grouping, not a claim of retail coverage.
Logo assets are embedded data URIs. No third-party logo service is contacted at runtime for catalog entries.
Sources and exact asset URLs are recorded per entry in carriers.ts.
Trademarks and logos remain the property of their respective owners and are used solely for identification; no endorsement is implied.
Custom routes may specify carrier=custom, country, name and logo (HTTPS URL or <=16KB raster upload stored in the public note).
Public notes are public: do not use private URLs, tokens or secrets. Custom HTTPS images are fetched by the visitor browser with no-referrer.
Legacy networkRoute and networkRoutes.other remain readable. Editing migrates the latter into ordered networkRouteEntries without dropping text.
Chinese raw labels: 其他运营商线路 / 国家地区 / 运营商 / 运营商名称 / Logo地址 / 线路名称.
Link tags: planDataMod.linkTags = [{name,url}], Chinese 链接标签 / 名称 / 网址.
Links accept HTTP(S) without embedded credentials, open with noopener noreferrer, and stop parent card navigation.
