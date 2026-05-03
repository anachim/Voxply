# Alliances

Alliances are Voxply's differentiator: named groups of hubs that share
channels, reactions, and (eventually) voice and games. A hub can be in
multiple alliances; users access alliance content through their home hub
without joining every member hub separately.

```
"WoW Alliance" = Hub A + Hub B
  Hub A shares #raids
  Hub B shares #guild-chat
  Users on Hub A see both. Users on Hub B see both.
```

## Tables

Defined in `server/voxply-hub/src/db/migrations.rs`:

- `alliances` — alliance id, name, creator, created_at
- `alliance_members` — alliance_id × hub_pubkey, with hub_name + hub_url
- `alliance_shared_channels` — alliance_id × channel_id (local channels
  the hub has chosen to share)

## Routes

All in `server/voxply-hub/src/routes/alliances.rs`:

| Route                                                | Who      | Purpose                              |
|------------------------------------------------------|----------|--------------------------------------|
| `POST   /alliances`                                  | admin    | Create alliance                      |
| `GET    /alliances`                                  | any auth | List alliances this hub is in        |
| `GET    /alliances/:id`                              | any auth | Details + members                    |
| `POST   /alliances/:id/invite`                       | admin    | Generate signed invite token         |
| `POST   /alliances/:id/join`                         | admin    | Use invite token to join (hub-to-hub)|
| `DELETE /alliances/:id/leave`                        | admin    | Leave alliance                       |
| `POST   /alliances/:id/channels`                     | admin    | Share a local channel                |
| `DELETE /alliances/:id/channels/:ch_id`              | admin    | Unshare a channel                    |
| `GET    /alliances/:id/channels`                     | any auth | All shared channels (local + remote) |
| `GET    /alliances/:id/channels/:ch_id/messages`     | any auth | Read messages (local or via peer)    |
| `POST   /alliances/:id/channels/:ch_id/messages`     | sender   | Post (federated to owning hub)       |

## Join flow

```
Hub A creates alliance        →  alliance_id (local)
Hub A: POST .../invite        →  signed invite token
Hub A → Hub B (out of band: paste link, etc.)
Hub B: POST .../join          →  authenticates to Hub A,
                                  Hub A verifies invite,
                                  both hubs persist membership
```

Out-of-band delivery is intentional — it's the same trust model as
sharing a server invite link in any community tool.

## Reading remote alliance messages

When Hub B fetches messages for an alliance channel that's owned by Hub A,
Hub B's `get_alliance_channel_messages` calls Hub A's federation endpoint
and caches results. For local channels, it loads from SQLite directly.
**Reactions are loaded in both branches** via
`messages::load_reactions` (the helper was made `pub(crate)` for this).

## What's not done

- Voice in alliance channels
- Game launch/lobby federation across alliance
- Member discovery beyond invite tokens

See ROADMAP.
