import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import Toasts from './components/Toasts';
import { EmptyState } from './components/ui';
import { IconSearch } from './components/Icons';
import Audit from './pages/Audit';
import Automation from './pages/Automation';
import Categories from './pages/catalog/Categories';
import CatalogOverview from './pages/catalog/CatalogOverview';
import Collections from './pages/catalog/Collections';
import ProductForm from './pages/catalog/ProductForm';
import Products from './pages/catalog/Products';
import Sync from './pages/catalog/Sync';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import Inbox from './pages/whatsapp/Inbox';
import Settings from './pages/whatsapp/Settings';
import Setup from './pages/whatsapp/Setup';
import { useApp } from './store/AppContext';

function NotFound() {
  return (
    <div className="page">
      <EmptyState
        icon={<IconSearch size={22} />}
        title="Page not found"
        description="The page you were looking for does not exist."
      />
    </div>
  );
}

export default function App() {
  const { booting, user, authRequired } = useApp();

  if (booting) {
    return (
      <div className="boot-screen">
        <span className="spinner spinner-lg" />
      </div>
    );
  }

  // With AUTH_ENABLED=false the server runs every request as a local admin, so
  // the sign-in screen would be theatre - skip it.
  if (authRequired && !user) {
    return (
      <>
        <Login />
        <Toasts />
      </>
    );
  }

  return (
    <>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />

          <Route path="whatsapp">
            <Route index element={<Navigate to="/whatsapp/setup" replace />} />
            <Route path="setup" element={<Setup />} />
            <Route path="settings" element={<Settings />} />
            <Route path="inbox" element={<Inbox />} />
          </Route>

          <Route path="catalog">
            <Route index element={<CatalogOverview />} />
            <Route path="products" element={<Products />} />
            <Route path="products/create" element={<ProductForm />} />
            <Route path="products/:id/edit" element={<ProductForm />} />
            <Route path="categories" element={<Categories />} />
            <Route path="collections" element={<Collections />} />
            <Route path="sync" element={<Sync />} />
          </Route>

          <Route path="automation" element={<Automation />} />
          <Route path="audit" element={<Audit />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
      <Toasts />
    </>
  );
}
