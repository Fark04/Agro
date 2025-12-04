import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Upload, LogOut, Loader, Trash2, Eye, AlertCircle } from 'lucide-react';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || `${window.location.origin}/api`;

export default function Dashboard({ setIsAuthenticated }) {
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    fetchImages();
  }, []);

  // Poll while any image is processing
  useEffect(() => {
    const hasPending = images.some(
      (img) => img.status !== 'completed' && img.status !== 'failed'
    );
    if (!hasPending) return;
    const id = setInterval(fetchImages, 3000);
    return () => clearInterval(id);
  }, [images]);

  const fetchImages = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const response = await axios.get(`${API_URL}/images`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setImages(response.data.images);
      setError('');
    } catch (err) {
      setError('Failed to load images');
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e) => {
    const files = e.target.files;
    if (!files) return;

    setUploading(true);
    const formData = new FormData();
    
    for (let i = 0; i < Math.min(files.length, 5); i++) {
      formData.append('images', files[i]);
    }

    try {
      const token = localStorage.getItem('token');
      const response = await axios.post(`${API_URL}/images/upload`, formData, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/form-data',
        },
      });

      setImages([...response.data.images, ...images]);
      setError('');
      
      // Refresh after a delay to get analysis results
      setTimeout(fetchImages, 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Вы уверены?')) return;

    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_URL}/images/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setImages(images.filter(img => img.id !== id));
    } catch (err) {
      setError('Failed to delete image');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setIsAuthenticated(false);
    navigate('/login');
  };

  const user = JSON.parse(localStorage.getItem('user') || '{}');

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-green-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">АгроЛаб</h1>
            <p className="text-gray-600 text-sm">Добро пожаловать, {user.username}!</p>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition"
          >
            <LogOut className="w-5 h-5" />
            Выход
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Upload Section */}
        <div className="bg-white rounded-lg shadow-lg p-8 mb-12">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Загрузить изображение поля</h2>
          
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-red-800 text-sm">{error}</p>
            </div>
          )}

          <div className="relative">
            <input
              type="file"
              multiple
              accept="image/*"
              onChange={handleFileUpload}
              disabled={uploading}
              className="hidden"
              id="file-input"
            />
            <label
              htmlFor="file-input"
              className={`block border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition ${
                uploading
                  ? 'border-gray-300 bg-gray-50'
                  : 'border-primary hover:border-green-600 hover:bg-green-50'
              }`}
            >
              {uploading ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader className="w-12 h-12 text-primary animate-spin" />
                  <p className="text-gray-600 font-semibold">Загрузка...</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <Upload className="w-12 h-12 text-primary" />
                  <p className="text-gray-900 font-semibold">Кликните или перетащите фото</p>
                  <p className="text-gray-500 text-sm">Поддерживаются JPEG, PNG, WebP (до 5 файлов)</p>
                </div>
              )}
            </label>
          </div>
        </div>

        {/* Images Grid */}
        <div className="bg-white rounded-lg shadow-lg p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Ваши анализы</h2>

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader className="w-12 h-12 text-primary animate-spin" />
            </div>
          ) : images.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500 text-lg">Нет загруженных изображений</p>
              <p className="text-gray-400 text-sm mt-2">Загрузите фото поля для анализа</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {images.map((image) => (
                <div
                  key={image.id}
                  className="bg-gradient-to-br from-gray-50 to-white rounded-lg overflow-hidden shadow-md hover:shadow-lg transition"
                >
                  <div className="aspect-square bg-gray-200 relative overflow-hidden">
                    <img
                      src={image.path}
                      alt={image.filename}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent flex items-end p-4">
                      <span
                        className={`px-3 py-1 rounded-full text-sm font-semibold text-white ${
                          image.status === 'completed'
                            ? 'bg-green-500'
                            : image.status === 'failed'
                            ? 'bg-red-500'
                            : 'bg-yellow-500'
                        }`}
                      >
                        {image.status === 'completed'
                          ? '✓ Анализ готов'
                          : image.status === 'failed'
                          ? '✗ Ошибка'
                          : '⏳ Обработка...'}
                      </span>
                    </div>
                  </div>

                  <div className="p-4">
                    <h3 className="font-semibold text-gray-900 truncate mb-2">
                      {image.originalName}
                    </h3>

                    {image.segmentationData && (
                      <div className="mb-4 space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-600">Сорняки:</span>
                          <span className="font-semibold text-red-600">
                            {image.segmentationData.weedCoverage || 0}%
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Урожай:</span>
                          <span className="font-semibold text-green-600">
                            {image.segmentationData.healthyCropCoverage || 0}%
                          </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                          <div
                            className="bg-gradient-to-r from-red-500 to-yellow-500 h-full"
                            style={{
                              width: `${image.segmentationData.weedCoverage || 0}%`,
                            }}
                          ></div>
                        </div>
                      </div>
                    )}

                    <div className="flex gap-2">
                      <Link
                        to={`/image/${image.id}`}
                        className="flex-1 bg-primary text-white py-2 rounded-lg flex items-center justify-center gap-2 hover:bg-green-600 transition"
                      >
                        <Eye className="w-4 h-4" />
                        Просмотр
                      </Link>
                      <button
                        onClick={() => handleDelete(image.id)}
                        className="bg-red-50 text-red-600 p-2 rounded-lg hover:bg-red-100 transition"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
