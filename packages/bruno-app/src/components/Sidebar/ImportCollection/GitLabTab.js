import React, { useEffect, useRef, useState } from 'react';
import Button from 'ui/Button';

const getErrorMessage = (error, fallback) => error?.message || fallback;

const GitLabTab = ({ handleSubmit, setErrorMessage }) => {
  const [settings, setSettings] = useState({ baseUrl: '', configured: false });
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [projects, setProjects] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [cloneProtocol, setCloneProtocol] = useState('https');
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [localError, setLocalError] = useState('');
  const requestSeq = useRef(0);

  const loadProjects = async ({ searchValue, pageValue }) => {
    const requestId = requestSeq.current + 1;
    requestSeq.current = requestId;
    setLoadingProjects(true);
    setLocalError('');
    try {
      const result = await window.ipcRenderer.invoke('renderer:list-gitlab-projects', {
        search: searchValue,
        page: pageValue
      });
      if (requestSeq.current !== requestId) {
        return;
      }
      setProjects(result?.projects || []);
      setHasMore(!!result?.hasMore);
      setSubmittedSearch(searchValue);
      setPage(pageValue);
    } catch (error) {
      if (requestSeq.current !== requestId) {
        return;
      }
      setProjects([]);
      setHasMore(false);
      setLocalError(getErrorMessage(error, 'Failed to load GitLab projects'));
    } finally {
      if (requestSeq.current === requestId) {
        setLoadingProjects(false);
      }
    }
  };

  useEffect(() => {
    let mounted = true;
    window.ipcRenderer.invoke('renderer:get-gitlab-settings')
      .then((nextSettings) => {
        if (!mounted) {
          return;
        }
        const safeSettings = nextSettings || { baseUrl: '', configured: false };
        setSettings(safeSettings);
        if (safeSettings.configured) {
          loadProjects({ searchValue: '', pageValue: 1 });
        }
      })
      .catch((error) => {
        if (mounted) {
          setLocalError(getErrorMessage(error, 'Failed to load GitLab settings'));
        }
      })
      .finally(() => {
        if (mounted) {
          setLoadingSettings(false);
        }
      });

    return () => {
      mounted = false;
      requestSeq.current += 1;
    };
  }, []);

  const handleSearchSubmit = (event) => {
    event.preventDefault();
    setErrorMessage('');
    loadProjects({ searchValue: search.trim(), pageValue: 1 });
  };

  const handlePageChange = (pageValue) => {
    setErrorMessage('');
    loadProjects({ searchValue: submittedSearch, pageValue });
  };

  const handleImport = (project) => {
    const repositoryUrl = cloneProtocol === 'ssh' ? project.sshUrl : project.httpUrl;
    if (!repositoryUrl) {
      setErrorMessage(`This project does not have a ${cloneProtocol.toUpperCase()} clone URL`);
      return;
    }
    handleSubmit({ type: 'git-repository', repositoryUrl });
  };

  if (loadingSettings) {
    return <div className="text-xs opacity-70" data-testid="gitlab-loading-settings">Loading GitLab settings...</div>;
  }

  if (!settings.configured) {
    return (
      <div className="text-xs opacity-70" data-testid="gitlab-not-configured">
        Configure GitLab in Preferences before importing private projects.
      </div>
    );
  }

  return (
    <div data-testid="gitlab-import-tab">
      <div className="mb-3 text-xs opacity-70">
        {settings.baseUrl}
      </div>
      <form className="flex gap-2 mb-3" onSubmit={handleSearchSubmit}>
        <input
          id="gitlabProjectSearch"
          data-testid="gitlab-project-search-input"
          type="text"
          value={search}
          autoFocus
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search GitLab projects"
          className="flex-1 px-3 py-1 textbox"
        />
        <Button
          type="submit"
          size="sm"
          variant="filled"
          color="primary"
        >
          Search
        </Button>
      </form>

      <div className="flex items-center gap-4 mb-3 text-xs">
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name="gitlabCloneProtocol"
            value="https"
            checked={cloneProtocol === 'https'}
            onChange={() => setCloneProtocol('https')}
          />
          HTTPS
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name="gitlabCloneProtocol"
            value="ssh"
            checked={cloneProtocol === 'ssh'}
            onChange={() => setCloneProtocol('ssh')}
          />
          SSH
        </label>
      </div>

      {localError ? <div className="mb-3 text-xs text-red-500" role="alert">{localError}</div> : null}
      {loadingProjects ? <div className="text-xs opacity-70" data-testid="gitlab-loading-projects">Loading projects...</div> : null}
      {!loadingProjects && !localError && projects.length === 0 ? (
        <div className="text-xs opacity-70" data-testid="gitlab-empty-projects">No GitLab projects found.</div>
      ) : null}
      {!loadingProjects && projects.length > 0 ? (
        <div className="flex flex-col gap-2" data-testid="gitlab-project-list">
          {projects.map((project) => (
            <div
              key={project.id}
              className="flex items-center justify-between gap-3 border rounded-md p-2"
              data-testid="gitlab-project-row"
            >
              <div className="min-w-0">
                <div className="font-medium truncate">{project.name}</div>
                <div className="text-xs opacity-70 truncate">{project.pathWithNamespace}</div>
              </div>
              <Button type="button" size="sm" variant="outline" color="secondary" onClick={() => handleImport(project)}>
                Import
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex items-center justify-between mt-3">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          color="secondary"
          disabled={loadingProjects || page <= 1}
          onClick={() => handlePageChange(page - 1)}
        >
          Previous
        </Button>
        <span className="text-xs opacity-70" data-testid="gitlab-page-label">Page {page}</span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          color="secondary"
          disabled={loadingProjects || !hasMore}
          onClick={() => handlePageChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
};

export default GitLabTab;
