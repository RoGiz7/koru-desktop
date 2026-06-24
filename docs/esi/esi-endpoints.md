# Inventario de endpoints ESI

- **Capturado:** 2026-06-24T13:45:29.272Z
- **compatibility_date:** 2026-06-01
- **Versión spec:** 2026-05-19
- **Total endpoints:** 218
- **Categorías:** 36

> Generado por `scripts/capture-esi-spec.mjs`. Ejecútalo de nuevo (`npm run esi:capture`) para detectar cambios.

## Resumen por categoría

| Categoría | Endpoints |
|---|---:|
| Access List | 2 |
| Activities | 3 |
| Alliance | 4 |
| Assets | 6 |
| Calendar | 4 |
| Character | 14 |
| Clones | 2 |
| Contacts | 9 |
| Contracts | 9 |
| Corporation | 22 |
| Corporation Projects | 4 |
| Dogma | 5 |
| Faction Warfare | 8 |
| Fittings | 3 |
| Fleets | 14 |
| Freelance Jobs | 6 |
| Incursions | 1 |
| Industry | 8 |
| Insurance | 1 |
| Killmails | 3 |
| Location | 3 |
| Loyalty | 2 |
| Mail | 9 |
| Market | 11 |
| Meta | 3 |
| Planetary Interaction | 4 |
| Routes | 1 |
| Search | 1 |
| Skills | 3 |
| Sovereignty | 2 |
| Status | 1 |
| Structures | 6 |
| Universe | 30 |
| User Interface | 5 |
| Wallet | 6 |
| Wars | 3 |

## Access List (2)

| Método | Ruta | Scope | Descripción |
|---|---|---|---|
| GET | `/characters/{character_id}/access-lists` | esi-access.read_lists.v1 | List Access Lists |
| GET | `/characters/{character_id}/access-lists/{access_list_id}` | esi-access.read_lists.v1 | Get Access List details |

## Activities (3)

| Método | Ruta | Scope | Descripción |
|---|---|---|---|
| GET | `/characters/{character_id}/mercenary-tactical-operations` | esi-activities.read_character.v1 | List Mercenary Tactical Operations |
| GET | `/characters/{character_id}/mercenary-tactical-operations/{operation_id}` | esi-activities.read_character.v1 | Get Mercenary Tactical Operation details |
| GET | `/skyhooks/raidable` | — (público) | List (upcoming) raidable Skyhooks |

## Alliance (4)

| Método | Ruta | Scope | Descripción |
|---|---|---|---|
| GET | `/alliances` | — (público) | List all alliances |
| GET | `/alliances/{alliance_id}` | — (público) | Get alliance's public information |
| GET | `/alliances/{alliance_id}/corporations` | — (público) | List alliance's corporations |
| GET | `/alliances/{alliance_id}/icons` | — (público) | Get alliance icon |

## Assets (6)

| Método | Ruta | Scope | Descripción |
|---|---|---|---|
| GET | `/characters/{character_id}/assets` | esi-assets.read_assets.v1 | Get character assets |
| GET | `/corporations/{corporation_id}/assets` | esi-assets.read_corporation_assets.v1 | Get corporation assets |
| POST | `/characters/{character_id}/assets/locations` | esi-assets.read_assets.v1 | Get character asset locations |
| POST | `/characters/{character_id}/assets/names` | esi-assets.read_assets.v1 | Get character asset names |
| POST | `/corporations/{corporation_id}/assets/locations` | esi-assets.read_corporation_assets.v1 | Get corporation asset locations |
| POST | `/corporations/{corporation_id}/assets/names` | esi-assets.read_corporation_assets.v1 | Get corporation asset names |

## Calendar (4)

| Método | Ruta | Scope | Descripción |
|---|---|---|---|
| GET | `/characters/{character_id}/calendar` | esi-calendar.read_calendar_events.v1 | List calendar event summaries |
| GET | `/characters/{character_id}/calendar/{event_id}` | esi-calendar.read_calendar_events.v1 | Get an event |
| GET | `/characters/{character_id}/calendar/{event_id}/attendees` | esi-calendar.read_calendar_events.v1 | Get attendees |
| PUT | `/characters/{character_id}/calendar/{event_id}` | esi-calendar.respond_calendar_events.v1 | Respond to an event |

## Character (14)

| Método | Ruta | Scope | Descripción |
|---|---|---|---|
| GET | `/characters/{character_id}` | — (público) | Get character's public information |
| GET | `/characters/{character_id}/agents_research` | esi-characters.read_agents_research.v1 | Get agents research |
| GET | `/characters/{character_id}/blueprints` | esi-characters.read_blueprints.v1 | Get blueprints |
| GET | `/characters/{character_id}/corporationhistory` | — (público) | Get corporation history |
| GET | `/characters/{character_id}/fatigue` | esi-characters.read_fatigue.v1 | Get jump fatigue |
| GET | `/characters/{character_id}/medals` | esi-characters.read_medals.v1 | Get medals |
| GET | `/characters/{character_id}/notifications` | esi-characters.read_notifications.v1 | Get character notifications |
| GET | `/characters/{character_id}/notifications/contacts` | esi-characters.read_notifications.v1 | Get new contact notifications |
| GET | `/characters/{character_id}/portrait` | — (público) | Get character portraits |
| GET | `/characters/{character_id}/roles` | esi-characters.read_corporation_roles.v1 | Get character corporation roles |
| GET | `/characters/{character_id}/standings` | esi-characters.read_standings.v1 | Get standings |
| GET | `/characters/{character_id}/titles` | esi-characters.read_titles.v1 | Get character corporation titles |
| POST | `/characters/{character_id}/cspa` | esi-characters.read_contacts.v1 | Calculate a CSPA charge cost |
| POST | `/characters/affiliation` | — (público) | Character affiliation |

## Clones (2)

| Método | Ruta | Scope | Descripción |
|---|---|---|---|
| GET | `/characters/{character_id}/clones` | esi-clones.read_clones.v1 | Get clones |
| GET | `/characters/{character_id}/implants` | esi-clones.read_implants.v1 | Get active implants |

## Contacts (9)

| Método | Ruta | Scope | Descripción |
|---|---|---|---|
| DELETE | `/characters/{character_id}/contacts` | esi-characters.write_contacts.v1 | Delete contacts |
| GET | `/alliances/{alliance_id}/contacts` | esi-alliances.read_contacts.v1 | Get alliance contacts |
| GET | `/alliances/{alliance_id}/contacts/labels` | esi-alliances.read_contacts.v1 | Get alliance contact labels |
| GET | `/characters/{character_id}/contacts` | esi-characters.read_contacts.v1 | Get contacts |
| GET | `/characters/{character_id}/contacts/labels` | esi-characters.read_contacts.v1 | Get contact labels |
| GET | `/corporations/{corporation_id}/contacts` | esi-corporations.read_contacts.v1 | Get corporation contacts |
| GET | `/corporations/{corporation_id}/contacts/labels` | esi-corporations.read_contacts.v1 | Get corporation contact labels |
| POST | `/characters/{character_id}/contacts` | esi-characters.write_contacts.v1 | Add contacts |
| PUT | `/characters/{character_id}/contacts` | esi-characters.write_contacts.v1 | Edit contacts |

## Contracts (9)

| Método | Ruta | Scope | Descripción |
|---|---|---|---|
| GET | `/characters/{character_id}/contracts` | esi-contracts.read_character_contracts.v1 | Get contracts |
| GET | `/characters/{character_id}/contracts/{contract_id}/bids` | esi-contracts.read_character_contracts.v1 | Get contract bids |
| GET | `/characters/{character_id}/contracts/{contract_id}/items` | esi-contracts.read_character_contracts.v1 | Get contract items |
| GET | `/contracts/public/{region_id}` | — (público) | Get public contracts |
| GET | `/contracts/public/bids/{contract_id}` | — (público) | Get public contract bids |
| GET | `/contracts/public/items/{contract_id}` | — (público) | Get public contract items |
| GET | `/corporations/{corporation_id}/contracts` | esi-contracts.read_corporation_contracts.v1 | Get corporation contracts |
| GET | `/corporations/{corporation_id}/contracts/{contract_id}/bids` | esi-contracts.read_corporation_contracts.v1 | Get corporation contract bids |
| GET | `/corporations/{corporation_id}/contracts/{contract_id}/items` | esi-contracts.read_corporation_contracts.v1 | Get corporation contract items |

## Corporation (22)

| Método | Ruta | Scope | Descripción |
|---|---|---|---|
| GET | `/corporations/{corporation_id}` | — (público) | Get corporation's public information |
| GET | `/corporations/{corporation_id}/alliancehistory` | — (público) | Get alliance history |
| GET | `/corporations/{corporation_id}/blueprints` | esi-corporations.read_blueprints.v1 | Get corporation blueprints |
| GET | `/corporations/{corporation_id}/containers/logs` | esi-corporations.read_container_logs.v1 | Get all corporation ALSC logs |
| GET | `/corporations/{corporation_id}/divisions` | esi-corporations.read_divisions.v1 | Get corporation divisions |
| GET | `/corporations/{corporation_id}/facilities` | esi-corporations.read_facilities.v1 | Get corporation facilities |
| GET | `/corporations/{corporation_id}/icons` | — (público) | Get corporation icon |
| GET | `/corporations/{corporation_id}/medals` | esi-corporations.read_medals.v1 | Get corporation medals |
| GET | `/corporations/{corporation_id}/medals/issued` | esi-corporations.read_medals.v1 | Get corporation issued medals |
| GET | `/corporations/{corporation_id}/members` | esi-corporations.read_corporation_membership.v1 | Get corporation members |
| GET | `/corporations/{corporation_id}/members/limit` | esi-corporations.track_members.v1 | Get corporation member limit |
| GET | `/corporations/{corporation_id}/members/titles` | esi-corporations.read_titles.v1 | Get corporation's members' titles |
| GET | `/corporations/{corporation_id}/membertracking` | esi-corporations.track_members.v1 | Track corporation members |
| GET | `/corporations/{corporation_id}/roles` | esi-corporations.read_corporation_membership.v1 | Get corporation member roles |
| GET | `/corporations/{corporation_id}/roles/history` | esi-corporations.read_corporation_membership.v1 | Get corporation member roles history |
| GET | `/corporations/{corporation_id}/shareholders` | esi-wallet.read_corporation_wallets.v1 | Get corporation shareholders |
| GET | `/corporations/{corporation_id}/standings` | esi-corporations.read_standings.v1 | Get corporation standings |
| GET | `/corporations/{corporation_id}/starbases` | esi-corporations.read_starbases.v1 | Get corporation starbases (POSes) |
| GET | `/corporations/{corporation_id}/starbases/{starbase_id}` | esi-corporations.read_starbases.v1 | Get starbase (POS) detail |
| GET | `/corporations/{corporation_id}/structures` | esi-corporations.read_structures.v1 | Get corporation structures |
| GET | `/corporations/{corporation_id}/titles` | esi-corporations.read_titles.v1 | Get corporation titles |
| GET | `/corporations/npccorps` | — (público) | Get npc corporations |

## Corporation Projects (4)

| Método | Ruta | Scope | Descripción |
|---|---|---|---|
| GET | `/corporations/{corporation_id}/projects` | esi-corporations.read_projects.v1 | List corporation projects |
| GET | `/corporations/{corporation_id}/projects/{project_id}` | esi-corporations.read_projects.v1 | Get project details |
| GET | `/corporations/{corporation_id}/projects/{project_id}/contribution/{character_id}` | esi-corporations.read_projects.v1 | Get your project contribution |
| GET | `/corporations/{corporation_id}/projects/{project_id}/contributors` | esi-corporations.read_projects.v1 | List project contributors |

## Dogma (5)

| Método | Ruta | Scope | Descripción |
|---|---|---|---|
| GET | `/dogma/attributes` | — (público) | Get attributes |
| GET | `/dogma/attributes/{attribute_id}` | — (público) | Get attribute information |
| GET | `/dogma/dynamic/items/{type_id}/{item_id}` | — (público) | Get dynamic item information |
| GET | `/dogma/effects` | — (público) | Get effects |
| GET | `/dogma/effects/{effect_id}` | — (público) | Get effect information |

## Faction Warfare (8)

| Método | Ruta | Scope | Descripción |
|---|---|---|---|
| GET | `/characters/{character_id}/fw/stats` | esi-characters.read_fw_stats.v1 | Overview of a character involved in faction warfare |
| GET | `/corporations/{corporation_id}/fw/stats` | esi-corporations.read_fw_stats.v1 | Overview of a corporation involved in faction warfare |
| GET | `/fw/leaderboards` | — (público) | List of the top factions in faction warfare |
| GET | `/fw/leaderboards/characters` | — (público) | List of the top pilots in faction warfare |
| GET | `/fw/leaderboards/corporations` | — (público) | List of the top corporations in faction warfare |
| GET | `/fw/stats` | — (público) | An overview of statistics about factions involved in faction warfare |
| GET | `/fw/systems` | — (público) | Ownership of faction warfare systems |
| GET | `/fw/wars` | — (público) | Data about which NPC factions are at war |

## Fittings (3)

| Método | Ruta | Scope | Descripción |
|---|---|---|---|
| DELETE | `/characters/{character_id}/fittings/{fitting_id}` | esi-fittings.write_fittings.v1 | Delete fitting |
| GET | `/characters/{character_id}/fittings` | esi-fittings.read_fittings.v1 | Get fittings |
| POST | `/characters/{character_id}/fittings` | esi-fittings.write_fittings.v1 | Create fitting |

## Fleets (14)

| Método | Ruta | Scope | Descripción |
|---|---|---|---|
| DELETE | `/fleets/{fleet_id}/members/{member_id}` | esi-fleets.write_fleet.v1 | Kick fleet member |
| DELETE | `/fleets/{fleet_id}/squads/{squad_id}` | esi-fleets.write_fleet.v1 | Delete fleet squad |
| DELETE | `/fleets/{fleet_id}/wings/{wing_id}` | esi-fleets.write_fleet.v1 | Delete fleet wing |
| GET | `/characters/{character_id}/fleet` | esi-fleets.read_fleet.v1 | Get character fleet info |
| GET | `/fleets/{fleet_id}` | esi-fleets.read_fleet.v1 | Get fleet information |
| GET | `/fleets/{fleet_id}/members` | esi-fleets.read_fleet.v1 | Get fleet members |
| GET | `/fleets/{fleet_id}/wings` | esi-fleets.read_fleet.v1 | Get fleet wings |
| POST | `/fleets/{fleet_id}/members` | esi-fleets.write_fleet.v1 | Create fleet invitation |
| POST | `/fleets/{fleet_id}/wings` | esi-fleets.write_fleet.v1 | Create fleet wing |
| POST | `/fleets/{fleet_id}/wings/{wing_id}/squads` | esi-fleets.write_fleet.v1 | Create fleet squad |
| PUT | `/fleets/{fleet_id}` | esi-fleets.write_fleet.v1 | Update fleet |
| PUT | `/fleets/{fleet_id}/members/{member_id}` | esi-fleets.write_fleet.v1 | Move fleet member |
| PUT | `/fleets/{fleet_id}/squads/{squad_id}` | esi-fleets.write_fleet.v1 | Rename fleet squad |
| PUT | `/fleets/{fleet_id}/wings/{wing_id}` | esi-fleets.write_fleet.v1 | Rename fleet wing |

## Freelance Jobs (6)

| Método | Ruta | Scope | Descripción |
|---|---|---|---|
| GET | `/characters/{character_id}/freelance-jobs` | esi-characters.read_freelance_jobs.v1 | List character freelance jobs |
| GET | `/characters/{character_id}/freelance-jobs/{job_id}/participation` | esi-characters.read_freelance_jobs.v1 | Get character freelance job participation |
| GET | `/corporations/{corporation_id}/freelance-jobs` | esi-corporations.read_freelance_jobs.v1 | List corporation freelance jobs |
| GET | `/corporations/{corporation_id}/freelance-jobs/{job_id}/participants` | esi-corporations.read_freelance_jobs.v1 | List participants of a freelance job |
| GET | `/freelance-jobs` | — (público) | List freelance jobs |
| GET | `/freelance-jobs/{job_id}` | — (público) | Get freelance job details |

## Incursions (1)

| Método | Ruta | Scope | Descripción |
|---|---|---|---|
| GET | `/incursions` | — (público) | List incursions |

## Industry (8)

| Método | Ruta | Scope | Descripción |
|---|---|---|---|
| GET | `/characters/{character_id}/industry/jobs` | esi-industry.read_character_jobs.v1 | List character industry jobs |
| GET | `/characters/{character_id}/mining` | esi-industry.read_character_mining.v1 | Character mining ledger |
| GET | `/corporation/{corporation_id}/mining/extractions` | esi-industry.read_corporation_mining.v1 | Moon extraction timers |
| GET | `/corporation/{corporation_id}/mining/observers` | esi-industry.read_corporation_mining.v1 | Corporation mining observers |
| GET | `/corporation/{corporation_id}/mining/observers/{observer_id}` | esi-industry.read_corporation_mining.v1 | Observed corporation mining |
| GET | `/corporations/{corporation_id}/industry/jobs` | esi-industry.read_corporation_jobs.v1 | List corporation industry jobs |
| GET | `/industry/facilities` | — (público) | List industry facilities |
| GET | `/industry/systems` | — (público) | List solar system cost indices |

## Insurance (1)

| Método | Ruta | Scope | Descripción |
|---|---|---|---|
| GET | `/insurance/prices` | — (público) | List insurance levels |

## Killmails (3)

| Método | Ruta | Scope | Descripción |
|---|---|---|---|
| GET | `/characters/{character_id}/killmails/recent` | esi-killmails.read_killmails.v1 | Get a character's recent kills and losses |
| GET | `/corporations/{corporation_id}/killmails/recent` | esi-killmails.read_corporation_killmails.v1 | Get a corporation's recent kills and losses |
| GET | `/killmails/{killmail_id}/{killmail_hash}` | — (público) | Get a single killmail |

## Location (3)

| Método | Ruta | Scope | Descripción |
|---|---|---|---|
| GET | `/characters/{character_id}/location` | esi-location.read_location.v1 | Get character location |
| GET | `/characters/{character_id}/online` | esi-location.read_online.v1 | Get character online |
| GET | `/characters/{character_id}/ship` | esi-location.read_ship_type.v1 | Get current ship |

## Loyalty (2)

| Método | Ruta | Scope | Descripción |
|---|---|---|---|
| GET | `/characters/{character_id}/loyalty/points` | esi-characters.read_loyalty.v1 | Get loyalty points |
| GET | `/loyalty/stores/{corporation_id}/offers` | — (público) | List loyalty store offers |

## Mail (9)

| Método | Ruta | Scope | Descripción |
|---|---|---|---|
| DELETE | `/characters/{character_id}/mail/{mail_id}` | esi-mail.organize_mail.v1 | Delete a mail |
| DELETE | `/characters/{character_id}/mail/labels/{label_id}` | esi-mail.organize_mail.v1 | Delete a mail label |
| GET | `/characters/{character_id}/mail` | esi-mail.read_mail.v1 | Return mail headers |
| GET | `/characters/{character_id}/mail/{mail_id}` | esi-mail.read_mail.v1 | Return a mail |
| GET | `/characters/{character_id}/mail/labels` | esi-mail.read_mail.v1 | Get mail labels and unread counts |
| GET | `/characters/{character_id}/mail/lists` | esi-mail.read_mail.v1 | Return mailing list subscriptions |
| POST | `/characters/{character_id}/mail` | esi-mail.send_mail.v1 | Send a new mail |
| POST | `/characters/{character_id}/mail/labels` | esi-mail.organize_mail.v1 | Create a mail label |
| PUT | `/characters/{character_id}/mail/{mail_id}` | esi-mail.organize_mail.v1 | Update metadata about a mail |

## Market (11)

| Método | Ruta | Scope | Descripción |
|---|---|---|---|
| GET | `/characters/{character_id}/orders` | esi-markets.read_character_orders.v1 | List open orders from a character |
| GET | `/characters/{character_id}/orders/history` | esi-markets.read_character_orders.v1 | List historical orders by a character |
| GET | `/corporations/{corporation_id}/orders` | esi-markets.read_corporation_orders.v1 | List open orders from a corporation |
| GET | `/corporations/{corporation_id}/orders/history` | esi-markets.read_corporation_orders.v1 | List historical orders from a corporation |
| GET | `/markets/{region_id}/history` | — (público) | List historical market statistics in a region |
| GET | `/markets/{region_id}/orders` | — (público) | List orders in a region |
| GET | `/markets/{region_id}/types` | — (público) | List type IDs relevant to a market |
| GET | `/markets/groups` | — (público) | Get item groups |
| GET | `/markets/groups/{market_group_id}` | — (público) | Get item group information |
| GET | `/markets/prices` | — (público) | List market prices |
| GET | `/markets/structures/{structure_id}` | esi-markets.structure_markets.v1 | List orders in a structure |

## Meta (3)

| Método | Ruta | Scope | Descripción |
|---|---|---|---|
| GET | `/meta/changelog` | — (público) | Get changelog |
| GET | `/meta/compatibility-dates` | — (público) | Get compatibility dates |
| GET | `/meta/status` | — (público) | Get health status |

## Planetary Interaction (4)

| Método | Ruta | Scope | Descripción |
|---|---|---|---|
| GET | `/characters/{character_id}/planets` | esi-planets.manage_planets.v1 | Get colonies |
| GET | `/characters/{character_id}/planets/{planet_id}` | esi-planets.manage_planets.v1 | Get colony layout |
| GET | `/corporations/{corporation_id}/customs_offices` | esi-planets.read_customs_offices.v1 | List corporation customs offices |
| GET | `/universe/schematics/{schematic_id}` | — (público) | Get schematic information |

## Routes (1)

| Método | Ruta | Scope | Descripción |
|---|---|---|---|
| POST | `/route/{origin_system_id}/{destination_system_id}` | — (público) | Get route between two systems |

## Search (1)

| Método | Ruta | Scope | Descripción |
|---|---|---|---|
| GET | `/characters/{character_id}/search` | esi-search.search_structures.v1 | Search on a string |

## Skills (3)

| Método | Ruta | Scope | Descripción |
|---|---|---|---|
| GET | `/characters/{character_id}/attributes` | esi-skills.read_skills.v1 | Get character attributes |
| GET | `/characters/{character_id}/skillqueue` | esi-skills.read_skillqueue.v1 | Get character's skill queue |
| GET | `/characters/{character_id}/skills` | esi-skills.read_skills.v1 | Get character skills |

## Sovereignty (2)

| Método | Ruta | Scope | Descripción |
|---|---|---|---|
| GET | `/sovereignty/campaigns` | — (público) | List sovereignty campaigns |
| GET | `/sovereignty/systems` | — (público) | List sovereignty details for K-space systems |

## Status (1)

| Método | Ruta | Scope | Descripción |
|---|---|---|---|
| GET | `/status` | — (público) | Retrieve the uptime and player counts |

## Structures (6)

| Método | Ruta | Scope | Descripción |
|---|---|---|---|
| GET | `/characters/{character_id}/structures/mercenary-dens` | esi-structures.read_character.v1 | List Mercenary Dens |
| GET | `/characters/{character_id}/structures/mercenary-dens/{mercenary_den_id}` | esi-structures.read_character.v1 | Get Mercenary Den details |
| GET | `/corporations/{corporation_id}/structures/skyhooks` | esi-structures.read_corporation.v1 | List Skyhooks |
| GET | `/corporations/{corporation_id}/structures/skyhooks/{skyhook_id}` | esi-structures.read_corporation.v1 | Get Skyhook details |
| GET | `/corporations/{corporation_id}/structures/sovereignty-hubs` | esi-structures.read_corporation.v1 | List Sovereignty Hubs |
| GET | `/corporations/{corporation_id}/structures/sovereignty-hubs/{sovereignty_hub_id}` | esi-structures.read_corporation.v1 | Get Sovereignty Hub details |

## Universe (30)

| Método | Ruta | Scope | Descripción |
|---|---|---|---|
| GET | `/universe/ancestries` | — (público) | Get ancestries |
| GET | `/universe/asteroid_belts/{asteroid_belt_id}` | — (público) | Get asteroid belt information |
| GET | `/universe/bloodlines` | — (público) | Get bloodlines |
| GET | `/universe/categories` | — (público) | Get item categories |
| GET | `/universe/categories/{category_id}` | — (público) | Get item category information |
| GET | `/universe/constellations` | — (público) | Get constellations |
| GET | `/universe/constellations/{constellation_id}` | — (público) | Get constellation information |
| GET | `/universe/factions` | — (público) | Get factions |
| GET | `/universe/graphics` | — (público) | Get graphics |
| GET | `/universe/graphics/{graphic_id}` | — (público) | Get graphic information |
| GET | `/universe/groups` | — (público) | Get item groups |
| GET | `/universe/groups/{group_id}` | — (público) | Get item group information |
| GET | `/universe/moons/{moon_id}` | — (público) | Get moon information |
| GET | `/universe/planets/{planet_id}` | — (público) | Get planet information |
| GET | `/universe/races` | — (público) | Get character races |
| GET | `/universe/regions` | — (público) | Get regions |
| GET | `/universe/regions/{region_id}` | — (público) | Get region information |
| GET | `/universe/stargates/{stargate_id}` | — (público) | Get stargate information |
| GET | `/universe/stars/{star_id}` | — (público) | Get star information |
| GET | `/universe/stations/{station_id}` | — (público) | Get station information |
| GET | `/universe/structures` | — (público) | List all public structures |
| GET | `/universe/structures/{structure_id}` | esi-universe.read_structures.v1 | Get structure information |
| GET | `/universe/system_jumps` | — (público) | Get system jumps |
| GET | `/universe/system_kills` | — (público) | Get system kills |
| GET | `/universe/systems` | — (público) | Get solar systems |
| GET | `/universe/systems/{system_id}` | — (público) | Get solar system information |
| GET | `/universe/types` | — (público) | Get types |
| GET | `/universe/types/{type_id}` | — (público) | Get type information |
| POST | `/universe/ids` | — (público) | Bulk names to IDs |
| POST | `/universe/names` | — (público) | Get names and categories for a set of IDs |

## User Interface (5)

| Método | Ruta | Scope | Descripción |
|---|---|---|---|
| POST | `/ui/autopilot/waypoint` | esi-ui.write_waypoint.v1 | Set Autopilot Waypoint |
| POST | `/ui/openwindow/contract` | esi-ui.open_window.v1 | Open Contract Window |
| POST | `/ui/openwindow/information` | esi-ui.open_window.v1 | Open Information Window |
| POST | `/ui/openwindow/marketdetails` | esi-ui.open_window.v1 | Open Market Details |
| POST | `/ui/openwindow/newmail` | esi-ui.open_window.v1 | Open New Mail Window |

## Wallet (6)

| Método | Ruta | Scope | Descripción |
|---|---|---|---|
| GET | `/characters/{character_id}/wallet` | esi-wallet.read_character_wallet.v1 | Get a character's wallet balance |
| GET | `/characters/{character_id}/wallet/journal` | esi-wallet.read_character_wallet.v1 | Get character wallet journal |
| GET | `/characters/{character_id}/wallet/transactions` | esi-wallet.read_character_wallet.v1 | Get wallet transactions |
| GET | `/corporations/{corporation_id}/wallets` | esi-wallet.read_corporation_wallets.v1 | Returns a corporation's wallet balance |
| GET | `/corporations/{corporation_id}/wallets/{division}/journal` | esi-wallet.read_corporation_wallets.v1 | Get corporation wallet journal |
| GET | `/corporations/{corporation_id}/wallets/{division}/transactions` | esi-wallet.read_corporation_wallets.v1 | Get corporation wallet transactions |

## Wars (3)

| Método | Ruta | Scope | Descripción |
|---|---|---|---|
| GET | `/wars` | — (público) | List wars |
| GET | `/wars/{war_id}` | — (público) | Get war information |
| GET | `/wars/{war_id}/killmails` | — (público) | List kills for a war |

