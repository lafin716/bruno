import styled from 'styled-components';

const StyledWrapper = styled.div`
  .settings-form {
    max-width: 720px;
  }

  .settings-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 12px;
  }

  .settings-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
  }

  .settings-status {
    margin-top: 10px;
    font-size: ${(props) => props.theme.font.size.sm};
  }

  .settings-status.success {
    color: ${(props) => props.theme.status.success.text};
  }

  .settings-status.error {
    color: ${(props) => props.theme.status.danger.text};
  }

  .settings-help {
    margin-top: 10px;
    color: ${(props) => props.theme.colors.text.muted};
    font-size: ${(props) => props.theme.font.size.sm};
  }
`;

export default StyledWrapper;
