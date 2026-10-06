"""Cross-client picker bridge behavior (native inventory, no second discovery)."""
import sys
import pytest
from pathlib import Path

import os
HERMES_AGENT = Path(os.environ.get('HERMES_WEBUI_AGENT_DIR') or (Path.home() / '.hermes/hermes-agent'))
if not (HERMES_AGENT / 'hermes_cli').is_dir():
    pytest.skip('Hermes Agent installation required', allow_module_level=True)
sys.path.insert(0, str(HERMES_AGENT))

from api import picker_bridge


@pytest.fixture(scope='session', autouse=True)
def test_server():
    # Pure adapter unit tests do not require an HTTP subprocess.
    yield


def test_adapter_preserves_duplicate_model_names_and_colon_tags():
    payload = {'model': 'same:tag', 'provider': 'contabo-openai', 'providers': [
        {'slug': 'contabo-openai', 'name': 'Contabo', 'models': ['same:tag', 'org/model'], 'featured_models': ['org/model']},
        {'slug': 'zai-coding-plan', 'name': 'Z.ai', 'models': ['same:tag']} ]}
    mobile = picker_bridge.adapt_inventory(payload)
    pairs = {(g['provider_id'], m['model_id']) for g in mobile['groups'] for m in g['models']}
    assert pairs == {(p['slug'], m) for p in payload['providers'] for m in p['models']}
    assert mobile['default_model'] == 'same:tag'
    assert mobile['groups'][0]['models'][0]['id'] == '@contabo-openai:same:tag'


def test_effective_projection_does_not_mutate_raw(tmp_path, monkeypatch):
    import hermes_cli.fleet_catalog as fleet
    path = tmp_path / 'catalog.shared.yaml'
    path.write_text('version: 1\nproviders:\n  contabo-openai:\n    models: [a]\n  zai-coding-plan:\n    models: [b]\n')
    monkeypatch.setattr(fleet, 'catalog_path', lambda: path)
    raw = {'model': {'default': 'profile-a', 'provider': 'zai-coding-plan'}, 'providers': {}}
    effective = picker_bridge.effective_config(raw)
    assert set(effective['providers']) == {'contabo-openai', 'zai-coding-plan'}
    assert raw['providers'] == {}
    assert effective['model'] == raw['model']
    old = picker_bridge.catalog_signature()
    path.write_text(path.read_text().replace('[a]', '[c]'))
    assert picker_bridge.catalog_signature() != old


def test_rest_adapters_read_same_store_and_return_conflict(tmp_path, monkeypatch):
    monkeypatch.syspath_prepend(str(HERMES_AGENT))
    from hermes_cli import picker_preferences as prefs
    from api import routes
    from urllib.parse import urlparse
    monkeypatch.setattr(prefs, 'preference_path', lambda: tmp_path / 'shared.json')
    replies = []
    monkeypatch.setattr(routes, 'j', lambda handler, data: replies.append((200, data)) or True)
    monkeypatch.setattr(routes, 'bad', lambda handler, message, status=400: replies.append((status, message)) or True)
    assert routes._picker_preferences_response(None, 'GET')
    assert replies[-1][1]['initialized'] is False
    assert routes._picker_preferences_response(None, 'POST', {'expected_revision': 0, 'favorites': ['p::tag:free']})
    assert replies[-1][1] == prefs.get_preferences()
    routes._picker_preferences_response(None, 'POST', {'expected_revision': 0, 'favorites': []})
    assert replies[-1][0] == 409
    routes._picker_preferences_response(None, 'POST', {'expected_revision': True, 'favorites': []})
    assert replies[-1][0] == 400


def test_catalog_change_visible_in_effective_config_without_raw_write(tmp_path, monkeypatch):
    from api import config
    import hermes_cli.fleet_catalog as fleet
    monkeypatch.syspath_prepend(str(HERMES_AGENT))
    catalog = tmp_path / 'catalog.shared.yaml'
    catalog.write_text('version: 1\nproviders:\n  contabo-openai:\n    models: [one]\n')
    monkeypatch.setattr(fleet, 'catalog_path', lambda: catalog)
    profile = tmp_path / 'config.yaml'
    profile.write_text('model:\n  default: local-a\n  provider: contabo-openai\nproviders: {}\n')
    original = profile.read_bytes()
    monkeypatch.setattr(config, '_get_config_path', lambda: profile)
    config.reload_config()
    assert config.get_config()['providers']['contabo-openai']['models'] == ['one']
    catalog.write_text(catalog.read_text().replace('[one]', '[two]'))
    assert config.get_config()['providers']['contabo-openai']['models'] == ['two']
    assert config._load_yaml_config_file(profile)['providers'] == {}
    assert profile.read_bytes() == original


def test_profile_default_write_preserves_other_profile_catalog_and_settings(tmp_path, monkeypatch):
    from api import config, models, profiles
    import hermes_cli.fleet_catalog as fleet
    monkeypatch.syspath_prepend(str(HERMES_AGENT))
    catalog = tmp_path / 'catalog.shared.yaml'
    catalog.write_text('version: 1\nproviders:\n  contabo-openai:\n    models: [new:tag]\n')
    monkeypatch.setattr(fleet, 'catalog_path', lambda: catalog)
    a = tmp_path / 'a'; b = tmp_path / 'b'; a.mkdir(); b.mkdir()
    (a / 'config.yaml').write_text('model:\n  default: old\n  provider: contabo-openai\nproviders: {}\ntools: {keep: true}\n')
    (b / 'config.yaml').write_text('model: b-default\n')
    original_b = (b / 'config.yaml').read_bytes(); original_catalog = catalog.read_bytes()
    monkeypatch.setattr(config, '_get_config_path', lambda: a / 'config.yaml')
    monkeypatch.setattr(profiles, 'get_hermes_home_for_profile', lambda name: a if name == 'a' else b)
    monkeypatch.setattr(config, 'resolve_model_provider', lambda model: (model, 'contabo-openai', None))
    monkeypatch.setattr(config, '_main_model_supports_service_tier', lambda *args: False)
    config.set_hermes_default_model('new:tag', provider='contabo-openai')
    assert models._profile_default_model_state('a') == ('new:tag', 'contabo-openai')
    raw = config._load_yaml_config_file(a / 'config.yaml')
    assert raw['providers'] == {}
    assert raw['tools'] == {'keep': True}
    assert (b / 'config.yaml').read_bytes() == original_b
    assert catalog.read_bytes() == original_catalog


def test_native_inventory_profile_scope_parity(tmp_path, monkeypatch):
    monkeypatch.syspath_prepend(str(HERMES_AGENT))
    from contextlib import contextmanager
    from api import profiles
    import hermes_cli.inventory as inventory
    ctx = inventory.ConfigContext('zai-coding-plan', 'profile-a', '', {}, [])
    calls = []
    @contextmanager
    def scope(purpose):
        calls.append(purpose)
        yield
    monkeypatch.setattr(profiles, 'profile_env_for_active_request_readonly', scope)
    monkeypatch.setattr(inventory, 'load_picker_context', lambda: ctx)
    payload = {'provider': 'zai-coding-plan', 'model': 'profile-a', 'providers': [
        {'slug': 'zai-coding-plan', 'name': 'Z.ai', 'models': ['glm-5.3']},
        {'slug': 'contabo-openai', 'name': 'Contabo', 'models': ['gpt-6.1']} ]}
    def native(context, **kwargs):
        assert context is ctx
        assert kwargs == {'explicit_only': True, 'refresh': False}
        return payload
    monkeypatch.setattr(inventory, 'build_model_options_payload', native)
    mobile = picker_bridge.get_inventory()
    assert calls == ['/api/models']
    assert {(g['provider_id'], m['model_id']) for g in mobile['groups'] for m in g['models']} == {(p['slug'], m) for p in payload['providers'] for m in p['models']}


def test_preference_route_not_public_or_csrf_exempt(monkeypatch):
    from api import auth, routes
    assert '/api/model/preferences' not in auth.PUBLIC_PATHS
    assert routes._csrf_exempt_path('/api/model/preferences') is False


def test_provider_hint_uses_literal_longest_prefix_with_model_tags(monkeypatch):
    from api import config
    monkeypatch.setattr(config, 'get_config', lambda: {'providers': {'MiXeD:Provider': {}, 'MiXeD': {}}})
    monkeypatch.setattr(picker_bridge, 'effective_config', lambda raw: raw)
    assert config._parse_provider_qualified_model_id('@MiXeD:Provider:Org/Model:free') == ('Org/Model:free', 'MiXeD:Provider')
