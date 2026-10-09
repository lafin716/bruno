import styled from 'styled-components';

export default styled.div`
  height: 100%;
  overflow: auto;
  padding: 16px 20px;
  font-size: ${(props) => props.theme.font.size.sm};

  .description { color: ${(props) => props.theme.colors.text.muted}; margin-bottom: 14px; }
  .reference-row {
    border: 1px solid ${(props) => props.theme.input.border};
    border-radius: ${(props) => props.theme.border.radius.sm};
    padding: 12px;
    margin: 12px 0;
  }
  .reference-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  label { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
  input {
    width: 100%;
    min-width: 0;
    padding: 7px 9px;
    color: ${(props) => props.theme.text};
    background: ${(props) => props.theme.input.bg};
    border: 1px solid ${(props) => props.theme.input.border};
    border-radius: ${(props) => props.theme.border.radius.sm};
    &:focus { outline: none; border-color: ${(props) => props.theme.input.focusBorder}; }
  }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .feedback { margin: 12px 0; overflow-wrap: anywhere; }
  [role='alert'] { color: ${(props) => props.theme.colors.text.danger}; }
  @media (max-width: 900px) { .reference-fields { grid-template-columns: minmax(0, 1fr); } }
`;
