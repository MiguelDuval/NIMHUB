"""Integration test for model normalization logic."""

from nimhub_gateway.nvidia import normalize_nim_model, KNOWN_MODELS, infer_capabilities_heuristic


def test_known_models():
    """Test all 10 known models in registry."""
    for model_id, expected in KNOWN_MODELS.items():
        raw = {'id': model_id, 'name': expected['name']}
        result = normalize_nim_model(raw)
        
        assert result.capability_source == 'registry', f'{model_id}: expected registry source'
        assert result.capabilities == expected['capabilities'], f'{model_id}: capabilities mismatch'
        assert result.context_window == expected['context_window'], f'{model_id}: context_window mismatch'
        assert result.max_output_tokens == expected['max_output_tokens'], f'{model_id}: max_output_tokens mismatch'
        assert result.input_modalities == expected['input_modalities'], f'{model_id}: input_modalities mismatch'
        assert result.output_modalities == expected['output_modalities'], f'{model_id}: output_modalities mismatch'
        assert result.endpoint_family == expected['endpoint_family'], f'{model_id}: endpoint_family mismatch'
        print(f'✓ {model_id}: {result.capabilities} (ctx={result.context_window}, out={result.max_output_tokens}) source={result.capability_source}')


def test_heuristic_fallback():
    """Test heuristic inference for unknown models."""
    # Unknown model - conservative defaults (chat only, no tool-calling without indicators)
    raw = {'id': 'unknown/new-model', 'name': 'Unknown Model'}
    result = normalize_nim_model(raw)
    assert result.capability_source == 'heuristic'
    assert result.capabilities == ['chat'], f'Expected chat only for unknown model, got {result.capabilities}'
    assert result.context_window is None
    assert result.max_output_tokens is None
    print(f'✓ unknown/new-model: {result.capabilities} source={result.capability_source}')

    # Model with tool-calling indicators
    raw = {'id': 'meta/llama-3-chat', 'name': 'Llama 3 Chat'}
    result = normalize_nim_model(raw)
    assert 'tool-calling' in result.capabilities
    print(f'✓ meta/llama-3-chat: {result.capabilities} source={result.capability_source}')

    # Vision model detection - no tool-calling unless indicators present
    raw = {'id': 'some/vision-model', 'name': 'Vision Model'}
    result = normalize_nim_model(raw)
    assert 'vision' in result.capabilities
    assert 'image' in result.input_modalities
    assert 'tool-calling' not in result.capabilities, 'Vision model without tool indicators should not get tool-calling'
    print(f'✓ some/vision-model: {result.capabilities} source={result.capability_source}')

    # Reasoning model detection
    raw = {'id': 'deepseek-r1', 'name': 'DeepSeek R1'}
    result = normalize_nim_model(raw)
    assert 'reasoning' in result.capabilities
    assert 'tool-calling' in result.capabilities  # deepseek-r1 has reasoning indicator
    print(f'✓ deepseek-r1: {result.capabilities} source={result.capability_source}')

    # Image generation detection
    raw = {'id': 'flux', 'name': 'Flux'}
    result = normalize_nim_model(raw)
    assert 'image-generation' in result.capabilities
    assert 'image' in result.output_modalities
    assert result.endpoint_family == 'image'
    # flux doesn't have tool-calling indicators
    print(f'✓ flux: {result.capabilities} source={result.capability_source}')

    # Video generation detection
    raw = {'id': 'stable-video', 'name': 'Stable Video'}
    result = normalize_nim_model(raw)
    assert 'video-generation' in result.capabilities
    assert 'video' in result.output_modalities
    assert result.endpoint_family == 'video'
    print(f'✓ stable-video: {result.capabilities} source={result.capability_source}')

    # ASR detection
    raw = {'id': 'whisper', 'name': 'Whisper'}
    result = normalize_nim_model(raw)
    assert 'asr' in result.capabilities
    assert 'audio' in result.input_modalities
    assert result.endpoint_family == 'speech'
    print(f'✓ whisper: {result.capabilities} source={result.capability_source}')

    # TTS detection
    raw = {'id': 'parakeet', 'name': 'Parakeet'}
    result = normalize_nim_model(raw)
    assert 'tts' in result.capabilities
    assert 'audio' in result.output_modalities
    assert result.endpoint_family == 'speech'
    print(f'✓ parakeet: {result.capabilities} source={result.capability_source}')


def test_conservative_heuristic():
    """Test that heuristic doesn't claim capabilities without evidence."""
    # Model name with no special keywords - should only get chat (no tool-calling without indicators)
    raw = {'id': 'some/random-model', 'name': 'Random Model'}
    result = normalize_nim_model(raw)
    assert result.capabilities == ['chat'], f'Expected chat only for random model, got {result.capabilities}'
    assert result.capability_source == 'heuristic'
    print(f'✓ conservative: {result.capabilities} source={result.capability_source}')


if __name__ == '__main__':
    test_known_models()
    test_heuristic_fallback()
    test_conservative_heuristic()
    print('\n✅ All normalization tests passed!')