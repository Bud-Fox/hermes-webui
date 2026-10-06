"""Thin adapters to Hermes Agent's authoritative picker and preferences."""
from __future__ import annotations


def effective_config(raw: dict) -> dict:
    from hermes_cli.fleet_catalog import apply_fleet_catalog
    return apply_fleet_catalog(raw)


def catalog_signature() -> str:
    import hashlib
    from hermes_cli.fleet_catalog import catalog_path
    try:
        data = catalog_path().read_bytes()
    except FileNotFoundError:
        data = b''
    return hashlib.sha256(data).hexdigest()


def adapt_inventory(payload: dict) -> dict:
    groups = []
    badges = {}
    for row in payload['providers']:
        provider = row['slug']
        entries = []
        for model in row.get('models', []):
            entry = {'id': f'@{provider}:{model}', 'model_id': model, 'label': model}
            capability = (row.get('capabilities') or {}).get(model) or {}
            if 'fast' in capability:
                entry['supports_fast_tier'] = capability['fast']
            if model in (row.get('pricing') or {}):
                entry['pricing'] = row['pricing'][model]
            entries.append(entry)
            if provider == payload['provider'] and model == payload['model']:
                badges[entry['id']] = {'provider': provider, 'role': 'default', 'label': 'Default'}
        groups.append({'provider': row.get('name') or provider, 'provider_id': provider,
            'models': entries, 'featured_models': row.get('featured_models', [])})
    return {'active_provider': payload['provider'], 'default_model': payload['model'],
            'groups': groups, 'shared_picker': True, 'configured_model_badges': badges}


def get_inventory(*, refresh=False) -> dict:
    from api.profiles import profile_env_for_active_request_readonly
    from hermes_cli.inventory import build_model_options_payload, load_picker_context
    with profile_env_for_active_request_readonly('/api/models'):
        return adapt_inventory(build_model_options_payload(load_picker_context(), explicit_only=True, refresh=refresh))


def get_preferences() -> dict:
    from hermes_cli.picker_preferences import get_preferences as read
    return read()


def update_preferences(payload: dict) -> dict:
    from hermes_cli.picker_preferences import update_preferences as update
    return update(payload)
