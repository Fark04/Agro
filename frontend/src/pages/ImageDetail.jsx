import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader, AlertCircle, CheckCircle, XCircle } from 'lucide-react';
import axios from 'axios';
import '../styles/processingStatus.css';

const API_URL = import.meta.env.VITE_API_URL || `${window.location.origin}/api`;

export default function ImageDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [image, setImage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const canvasRef = useRef(null);
  const previousSegDataRef = useRef(null);

  useEffect(() => {
    fetchImage();
  }, [id]);

  // Poll image detail until analysis completes
  useEffect(() => {
    if (!image) return;
    const done = image.status === 'completed' || image.status === 'failed';
    if (done) return;
    const pollId = setInterval(() => {
      pollImageStatus();
    }, 3000);
    return () => clearInterval(pollId);
  }, [image]);

  useEffect(() => {
    if (image && image.segmentationData) {
      // Only redraw if segmentation data has actually changed
      const currentSegData = JSON.stringify(image.segmentationData);
      const previousSegData = previousSegDataRef.current;
      
      if (currentSegData !== previousSegData) {
        previousSegDataRef.current = currentSegData;
        drawSegmentation();
      }
    }
  }, [image?.segmentationData]);

  const fetchImage = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const response = await axios.get(`${API_URL}/images/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setImage(response.data);
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load image');
    } finally {
      setLoading(false);
    }
  };

  const pollImageStatus = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`${API_URL}/images/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setImage(response.data);
      // Don't clear error during polling, only on successful initial load
    } catch (err) {
      // Silently handle polling errors to avoid flickering
      console.error('Polling error:', err);
    }
  };

  const drawSegmentation = () => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;

    const ctx = canvas.getContext('2d');
    const img = new Image();

    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      const segData = image.segmentationData;

      // New items format (boxes only)
      if (segData && Array.isArray(segData.items) && segData.items.length > 0) {
        segData.items.forEach((item) => {
          if (!Array.isArray(item.box_2d) || item.box_2d.length !== 4) return;

          const ymin = (item.box_2d[0] / 1000) * img.height;
          const xmin = (item.box_2d[1] / 1000) * img.width;
          const ymax = (item.box_2d[2] / 1000) * img.height;
          const xmax = (item.box_2d[3] / 1000) * img.width;

          const x = Math.max(0, Math.min(xmin, img.width));
          const y = Math.max(0, Math.min(ymin, img.height));
          const width = Math.max(0, Math.min(xmax - xmin, img.width - x));
          const height = Math.max(0, Math.min(ymax - ymin, img.height - y));

          // Choose color by label
          let color = '#3B82F6';
          if ((item.label || '').toLowerCase().includes('weed')) color = '#EF4444';
          else if ((item.label || '').toLowerCase().includes('crop')) color = '#10B981';
          else if ((item.label || '').toLowerCase().includes('soil')) color = '#F59E0B';

          // Draw only box and label
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.strokeRect(x, y, width, height);
          const label = `${item.label || 'item'} (${Math.round(item.confidence || 0)}%)`;
          ctx.font = 'bold 14px Arial';
          const textWidth = ctx.measureText(label).width;
          const labelX = x + 6;
          const labelY = y + 18;
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.fillRect(labelX - 4, labelY - 14, textWidth + 8, 18);
          ctx.fillStyle = '#ffffff';
          ctx.fillText(label, labelX, labelY);
        });
      }

      // Backward compatibility: draw old zones rectangles
      if (segData && segData.zones) {
        segData.zones.forEach((zone) => {
          let x = 0;
          let y = 0;
          let width = 0;
          let height = 0;

          if (zone?.boundingBox) {
            const bbox = zone.boundingBox;
            const bx = parseFloat(bbox.x) || 0;
            const by = parseFloat(bbox.y) || 0;
            const bw = parseFloat(bbox.width) || 0;
            const bh = parseFloat(bbox.height) || 0;
            x = (bx / 100) * img.width;
            y = (by / 100) * img.height;
            width = (bw / 100) * img.width;
            height = (bh / 100) * img.height;
          } else if (Array.isArray(zone?.box_2d) && zone.box_2d.length === 4) {
            // Fallback for Gemini 2.x style [ymin, xmin, ymax, xmax] normalized 0-1000
            const ymin = zone.box_2d[0] / 1000;
            const xmin = zone.box_2d[1] / 1000;
            const ymax = zone.box_2d[2] / 1000;
            const xmax = zone.box_2d[3] / 1000;
            x = Math.max(0, xmin) * img.width;
            y = Math.max(0, ymin) * img.height;
            width = Math.max(0, xmax - xmin) * img.width;
            height = Math.max(0, ymax - ymin) * img.height;
          } else {
            return; // skip invalid zone
          }

          // Clamp to canvas bounds
          x = Math.max(0, Math.min(x, img.width));
          y = Math.max(0, Math.min(y, img.height));
          width = Math.max(0, Math.min(width, img.width - x));
          height = Math.max(0, Math.min(height, img.height - y));

          // Color based on type
          let color = '#3B82F6';
          let fillColor = 'rgba(59, 130, 246, 0.2)';

          if (zone.type === 'weed') {
            color = '#EF4444';
            fillColor = 'rgba(239, 68, 68, 0.2)';
          } else if (zone.type === 'crop') {
            color = '#10B981';
            fillColor = 'rgba(16, 185, 129, 0.2)';
          } else if (zone.type === 'bare_soil') {
            color = '#F59E0B';
            fillColor = 'rgba(245, 158, 11, 0.2)';
          }

          // Draw filled rectangle
          ctx.fillStyle = fillColor;
          ctx.fillRect(x, y, width, height);

          // Draw border
          ctx.strokeStyle = color;
          ctx.lineWidth = 3;
          ctx.strokeRect(x, y, width, height);

          // Draw label inside the box
          const label = `${zone.type} (${zone.confidence ?? 0}%)`;
          ctx.font = 'bold 14px Arial';
          const textWidth = ctx.measureText(label).width;
          const labelX = x + 6;
          const labelY = y + 18;
          // Optional background for readability
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.fillRect(labelX - 4, labelY - 14, textWidth + 8, 18);
          ctx.fillStyle = '#ffffff';
          ctx.fillText(label, labelX, labelY);
        });
      }
    };

    // image.path is absolute (/uploads/..). Use same-origin URL.
    img.src = image.path;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader className="w-12 h-12 text-primary animate-spin" />
      </div>
    );
  }

  if (error || !image) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-green-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full">
          <div className="flex gap-3 mb-4">
            <AlertCircle className="w-6 h-6 text-red-500 flex-shrink-0" />
            <div>
              <h3 className="font-semibold text-gray-900">Ошибка</h3>
              <p className="text-gray-600 mt-1">{error}</p>
            </div>
          </div>
          <button
            onClick={() => navigate('/dashboard')}
            className="w-full bg-primary text-white py-2 rounded-lg hover:bg-green-600 transition"
          >
            Вернуться
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-green-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center gap-4">
          <button
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-2 px-4 py-2 hover:bg-gray-100 rounded-lg transition"
          >
            <ArrowLeft className="w-5 h-5" />
            Назад
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Анализ изображения</h1>
            <p className="text-gray-600 text-sm">{image.filename}</p>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Canvas */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow-lg overflow-hidden">
              <canvas
                ref={canvasRef}
                className="w-full h-auto bg-gray-100"
              />
            </div>
          </div>

          {/* Analysis Results */}
          <div className="space-y-6">
            {/* Status */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h3 className="font-semibold text-gray-900 mb-4">Статус анализа</h3>
              {image.status === 'processing' ? (
                <div className="processing-status">
                  <div className="status-card">
                    <div className="spinner">
                      <div className="spinner-ring"></div>
                      <div className="spinner-ring"></div>
                      <div className="spinner-ring"></div>
                    </div>
                    <div className="status-text">
                      <p className="status-label">Обработка</p>
                      <p className="status-description">Анализируем изображение...</p>
                    </div>
                  </div>
                </div>
              ) : image.status === 'completed' ? (
                <div className="success-status">
                  <div className="status-card success">
                    <CheckCircle className="w-8 h-8 text-green-500" />
                    <div className="status-text">
                      <p className="status-label">Готово</p>
                      <p className="status-description">Анализ успешно завершен</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="error-status">
                  <div className="status-card error">
                    <XCircle className="w-8 h-8 text-red-500" />
                    <div className="status-text">
                      <p className="status-label">Ошибка</p>
                      <p className="status-description">Ошибка при обработке</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Coverage Stats */}
            {image.segmentationData && (
              <>
                <div className="bg-white rounded-lg shadow-lg p-6">
                  <h3 className="font-semibold text-gray-900 mb-4">Статистика</h3>
                  <div className="space-y-4">
                    <div>
                      <div className="flex justify-between mb-2">
                        <span className="text-gray-600">Покрытие сорняками</span>
                        <span className="font-semibold text-red-600">
                          {image.segmentationData.weedCoverage || 0}%
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                        <div
                          className="bg-gradient-to-r from-red-400 to-red-600 h-full"
                          style={{
                            width: `${image.segmentationData.weedCoverage || 0}%`,
                          }}
                        ></div>
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between mb-2">
                        <span className="text-gray-600">Здоровый урожай</span>
                        <span className="font-semibold text-green-600">
                          {image.segmentationData.healthyCropCoverage || 0}%
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                        <div
                          className="bg-gradient-to-r from-green-400 to-green-600 h-full"
                          style={{
                            width: `${image.segmentationData.healthyCropCoverage || 0}%`,
                          }}
                        ></div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Legend */}
                <div className="bg-white rounded-lg shadow-lg p-6">
                  <h3 className="font-semibold text-gray-900 mb-4">Легенда</h3>
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="w-4 h-4 bg-red-500 rounded"></div>
                      <span className="text-gray-600">Сорняки</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-4 h-4 bg-green-500 rounded"></div>
                      <span className="text-gray-600">Урожай</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-4 h-4 bg-yellow-500 rounded"></div>
                      <span className="text-gray-600">Голая почва</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-4 h-4 bg-blue-500 rounded"></div>
                      <span className="text-gray-600">Прочее</span>
                    </div>
                  </div>
                </div>

                {/* Items (new format) */}
                {image.segmentationData.items && image.segmentationData.items.length > 0 && (
                  <div className="bg-white rounded-lg shadow-lg p-6">
                    <h3 className="font-semibold text-gray-900 mb-4">Обнаруженные объекты</h3>
                    <div className="space-y-3 max-h-96 overflow-y-auto">
                      {image.segmentationData.items.map((it, idx) => (
                        <div
                          key={idx}
                          className="p-3 bg-gray-50 rounded-lg border-l-4"
                          style={{
                            borderColor:
                              (it.label || '').toLowerCase().includes('weed')
                                ? '#ef4444'
                                : (it.label || '').toLowerCase().includes('crop')
                                ? '#10b981'
                                : (it.label || '').toLowerCase().includes('soil')
                                ? '#f59e0b'
                                : '#3b82f6',
                          }}
                        >
                          <p className="font-semibold text-gray-900 capitalize">
                            {it.label || 'item'}
                          </p>
                          <div className="flex justify-between mt-2 text-xs">
                            <span className="text-gray-600">
                              Уверенность: {Math.round(it.confidence || 0)}%
                            </span>
                            {Array.isArray(it.box_2d) && it.box_2d.length === 4 && (
                              <span className="text-gray-600">box_2d: [{it.box_2d.join(', ')}]</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Zones */}
                {image.segmentationData.zones && image.segmentationData.zones.length > 0 && (
                  <div className="bg-white rounded-lg shadow-lg p-6">
                    <h3 className="font-semibold text-gray-900 mb-4">Обнаруженные зоны</h3>
                    <div className="space-y-3 max-h-96 overflow-y-auto">
                      {image.segmentationData.zones.map((zone, idx) => (
                        <div
                          key={idx}
                          className="p-3 bg-gray-50 rounded-lg border-l-4"
                          style={{
                            borderColor:
                              zone.type === 'weed'
                                ? '#ef4444'
                                : zone.type === 'crop'
                                ? '#10b981'
                                : zone.type === 'bare_soil'
                                ? '#f59e0b'
                                : '#3b82f6',
                          }}
                        >
                          <p className="font-semibold text-gray-900 capitalize">
                            {zone.type}
                          </p>
                          <p className="text-sm text-gray-600">{zone.description}</p>
                          <div className="flex justify-between mt-2 text-xs">
                            <span className="text-gray-600">
                              Площадь: {zone.area}%
                            </span>
                            <span className="font-semibold text-gray-700">
                              Уверенность: {zone.confidence}%
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recommendations */}
                {image.segmentationData.recommendations && (
                  <div className="bg-white rounded-lg shadow-lg p-6">
                    <h3 className="font-semibold text-gray-900 mb-4">Рекомендации</h3>
                    <ul className="space-y-2">
                      {image.segmentationData.recommendations.map((rec, idx) => (
                        <li key={idx} className="flex gap-2 text-sm text-gray-600">
                          <span className="text-primary">•</span>
                          <span>{rec}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
