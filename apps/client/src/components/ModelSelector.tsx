import { useState, useMemo } from 'react';
import type { ModelCapabilityInfo } from '../types';
import { sortModels, isVerifiedModel, getCapabilitySource } from '../services/models';

interface ModelSelectorProps {
  models: ModelCapabilityInfo[];
  selectedModelId: string;
  onChange: (modelId: string) => void;
  disabled?: boolean;
  loading?: boolean;
  showDetails?: boolean;
  onToggleDetails?: () => void;
  /** Filter to only show models with specific capability */
  filterCapability?: ModelCapabilityInfo['capabilities'][number];
}

export function ModelSelector({
  models,
  selectedModelId,
  onChange,
  disabled,
  loading = false,
  showDetails,
  onToggleDetails,
  filterCapability,
}: ModelSelectorProps) {
  const selectedModel = models.find((m) => m.id === selectedModelId);
  const [search, setSearch] = useState('');

  // Sort and filter models
  const availableModels = useMemo(() => {
    let filtered = sortModels(models);

    if (filterCapability) {
      filtered = filtered.filter((m) => m.capabilities.includes(filterCapability));
    }

    if (search.trim()) {
      const query = search.toLowerCase();
      filtered = filtered.filter(
        (m) =>
          (m.name ?? m.id).toLowerCase().includes(query) ||
          m.id.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [models, filterCapability, search]);

  return (
    <div className="model-selector-wrapper">
      <div className="model-selector-search">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search models…"
          disabled={disabled}
          className="model-search-input"
        />
      </div>
      <select
        id="model-select"
        value={selectedModelId}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || availableModels.length === 0}
        className="model-select"
      >
        {loading ? (
          <option value="">Loading models…</option>
        ) : availableModels.length === 0 ? (
          <option value="">No models available</option>
        ) : (
          availableModels.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name ?? model.id}
              {model.capabilities.includes('reasoning') && ' 🧠'}
              {model.capabilities.includes('vision') && ' 👁️'}
              {model.capabilities.includes('tool-calling') && ' 🔧'}
              {model.capabilities.includes('image-generation') && ' 🎨'}
              {model.capabilities.includes('video-generation') && ' 🎬'}
              {model.capabilities.includes('asr') && ' 🎤'}
              {model.capabilities.includes('tts') && ' 🔊'}
              {isVerifiedModel(model) && ' ✓'}
            </option>
          ))
        )}
      </select>
      {selectedModel && showDetails && (
        <div className="model-details-popover">
          <div className="model-detail-row">
            <span className="label">Provider:</span>
            <span>{selectedModel.provider}</span>
          </div>
          <div className="model-detail-row">
            <span className="label">Family:</span>
            <span>{selectedModel.endpointFamily}</span>
          </div>
          <div className="model-detail-row">
            <span className="label">Context:</span>
            <span>
              {selectedModel.contextWindow
                ? `${(selectedModel.contextWindow / 1000).toFixed(0)}k`
                : 'Unknown'}
            </span>
          </div>
          <div className="model-detail-row">
            <span className="label">Max Output:</span>
            <span>
              {selectedModel.maxOutputTokens
                ? `${(selectedModel.maxOutputTokens / 1000).toFixed(0)}k`
                : 'Unknown'}
            </span>
          </div>
          <div className="model-detail-row">
            <span className="label">Source:</span>
            <span className={`capability-source ${getCapabilitySource(selectedModel)}`}>
              {getCapabilitySource(selectedModel)}
            </span>
          </div>
          <div className="model-detail-row">
            <span className="label">Capabilities:</span>
            <span className="capabilities">
              {selectedModel.capabilities.map((c) => (
                <span key={c} className="capability-badge">{c}</span>
              ))}
            </span>
          </div>
          <div className="model-detail-row">
            <span className="label">Input:</span>
            <span>{selectedModel.inputModalities.join(', ')}</span>
          </div>
          <div className="model-detail-row">
            <span className="label">Output:</span>
            <span>{selectedModel.outputModalities.join(', ')}</span>
          </div>
          <div className="model-detail-row">
            <span className="label">Discovered:</span>
            <span>{new Date(selectedModel.discoveredAt).toLocaleString()}</span>
          </div>
        </div>
      )}
      {onToggleDetails && (
        <button
          className="icon-btn model-details-toggle"
          onClick={onToggleDetails}
          title={showDetails ? 'Hide details' : 'Show details'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {showDetails ? (
              <>
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
              </>
            ) : (
              <>
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </>
            )}
          </svg>
        </button>
      )}
    </div>
  );
}