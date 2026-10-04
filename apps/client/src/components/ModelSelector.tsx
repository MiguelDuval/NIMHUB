import type { ModelCapabilityInfo } from '../types';

interface ModelSelectorProps {
  models: ModelCapabilityInfo[];
  selectedModelId: string;
  onChange: (modelId: string) => void;
  disabled?: boolean;
  showDetails?: boolean;
  onToggleDetails?: () => void;
}

export function ModelSelector({
  models,
  selectedModelId,
  onChange,
  disabled,
  showDetails,
  onToggleDetails,
}: ModelSelectorProps) {
  const selectedModel = models.find((m) => m.id === selectedModelId);

  return (
    <div className="model-selector-wrapper">
      <select
        id="model-select"
        value={selectedModelId}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="model-select"
      >
        {models.length === 0 ? (
          <option value="">Loading models…</option>
        ) : (
          models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name ?? model.id}
              {model.capabilities.includes('reasoning') && ' 🧠'}
              {model.capabilities.includes('vision') && ' 👁️'}
              {model.capabilities.includes('tool-calling') && ' 🔧'}
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
            <span>{selectedModel.contextWindow ? `${(selectedModel.contextWindow / 1000).toFixed(0)}k` : 'Unknown'}</span>
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