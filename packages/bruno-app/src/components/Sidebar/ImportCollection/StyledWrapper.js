import styled from 'styled-components';
import { IMPORT_COLLECTION_SELECTION_WIDTH } from 'components/SelectionList/constants';

const StyledWrapper = styled.div`
  width: ${IMPORT_COLLECTION_SELECTION_WIDTH};
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;

  .ai-import-muted {
    color: ${(props) => props.theme.colors.text.muted};
    line-height: 1.6;
  }

  .ai-import-preview {
    border: 1px solid ${(props) => props.theme.input.border};
    border-radius: ${(props) => props.theme.border.radius.md};
    background: ${(props) => props.theme.input.bg};
    max-height: 40vh;
    overflow-y: auto;
    overflow-wrap: anywhere;
  }

  .tabs {
    .tab {
      padding: 6px 0px;
      border: none;
      border-bottom: solid 2px transparent;
      margin-right: 1.25rem;
      color: var(--color-tab-inactive);
      cursor: pointer;

      &:focus,
      &:active,
      &:focus-within,
      &:focus-visible,
      &:target {
        outline: none !important;
        box-shadow: none !important;
      }

      &.active {
        color: ${(props) => props.theme.tabs.active.color} !important;
        border-bottom: solid 2px ${(props) => props.theme.tabs.active.border} !important;
      }
    }
  }
`;

export default StyledWrapper;
