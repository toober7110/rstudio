/*
 * image-resize.ts
 *
 * Copyright (C) 2019-20 by RStudio, PBC
 *
 * Unless you have received this program directly from RStudio pursuant
 * to the terms of a commercial license agreement with RStudio, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

import { EditorView } from 'prosemirror-view';
import { NodeWithPos } from 'prosemirror-utils';
import { NodeSelection } from 'prosemirror-state';

import {
  createPopup,
  createHorizontalPanel,
  addHorizontalPanelCell,
  createInputLabel,
  createImageButton,
  createCheckboxInput,
  createSelectInput,
  createTextInput,
} from '../../api/widgets';
import { EditorUI } from '../../api/ui';
import { editingRootNode } from '../../api/node';

import { imageDialog } from './image-dialog';
import {
  unitToPixels,
  isNaturalAspectRatio,
  pixelsToUnit,
  roundUnit,
  sizePropWithUnit,
  validUnits,
  hasPercentWidth,
} from './image-util';
import { extractSizeStyles } from '../../api/css';

export function initResizeContainer(container: HTMLElement) {
  // add standard parent class
  container.classList.add('pm-image-resize-container', 'pm-selected-node-outline-color');

  // so that we are the offsetParent for the resize handles and shelf
  container.style.position = 'relative';

  // so that the container matches the size of the contained image
  container.style.display = 'inline-block';

  // so that the handles and shelf can be visible outside the boundaries of the image
  container.style.overflow = 'visible';

  // return for convenience
  return container;
}

export function isResizeUICompatible(img: HTMLImageElement) {
  // incompatible if it has a width, but not a data-width
  const incompatibleWidth = img.style.width && !img.hasAttribute('data-width');

  // incompatible if it has a height, but not a data-height
  const incompatibleHeight = img.style.height && img.style.height !== 'auto' && !img.hasAttribute('data-height');

  return !incompatibleWidth && !incompatibleHeight;
}

export interface ResizeUI {
  update: () => void;
  detach: () => void;
}

export function attachResizeUI(
  imageNode: () => NodeWithPos,
  container: HTMLElement,
  img: HTMLImageElement,
  imgContainerWidth: () => number,
  view: EditorView,
  ui: EditorUI,
): ResizeUI {
  // indicate that resize ui is active
  container.classList.add('pm-image-resize-active');

  // sync current state of shelf to node
  const syncFromShelf = () => {
    updateImageSize(view, imageNode(), img, shelf.props.width(), shelf.props.height(), shelf.props.units());
  };

  // shelf init
  const onInitShelf = () => {
    // sync props
    shelf.sync();

    // default for lockRatio based on naturalWidth/naturalHeight
    shelf.props.setLockRatio(isNaturalAspectRatio(shelf.props.width(), shelf.props.height(), img, true));
  };

  // handle width changed from shelf
  const onWidthChanged = () => {
    const width = shelf.props.width();
    const height = shelf.props.lockRatio() ? (img.offsetHeight / img.offsetWidth) * width : shelf.props.height();
    shelf.props.setHeight(height);

    syncFromShelf();
  };

  // handle height changed from shelf
  const onHeightChanged = () => {
    const height = shelf.props.height();
    const width = shelf.props.lockRatio() ? (img.offsetWidth / img.offsetHeight) * height : shelf.props.width();
    shelf.props.setWidth(width);

    syncFromShelf();
  };

  const onUnitsChanged = () => {
    const prevUnits = shelfSizeFromImage(img).unit;

    const containerWidth = imgContainerWidth();

    const width = shelf.props.width();
    const widthPixels = unitToPixels(width, prevUnits, containerWidth);
    shelf.props.setWidth(pixelsToUnit(widthPixels, shelf.props.units(), containerWidth));

    const height = shelf.props.height();
    const heightPixels = unitToPixels(height, prevUnits, containerWidth);
    shelf.props.setHeight(pixelsToUnit(heightPixels, shelf.props.units(), containerWidth));

    syncFromShelf();
  };

  // update image width for changes in container
  let lastContainerWidth = imgContainerWidth();
  const containerWidthTimer = setInterval(() => {
    const containerWidth = imgContainerWidth();
    if (containerWidth !== lastContainerWidth) {
      lastContainerWidth = containerWidth;
      if (shelf.props.units() === '%') {
        img.style.width = unitToPixels(shelf.props.width(), shelf.props.units(), containerWidth) + 'px';
        shelf.position();
      }
    }
  }, 25);

  // handle editImage request from shelf
  const onEditImage = () => {
    const nodeWithPos = imageNode();
    imageDialog(nodeWithPos.node, nodeWithPos.node.type, view.state, view.dispatch, view, ui, true);
  };

  // create resize shelf
  const shelf = resizeShelf(
    view,
    img,
    onInitShelf,
    onWidthChanged,
    onHeightChanged,
    onUnitsChanged,
    onEditImage,
    ui.context.translateText,
  );
  container.append(shelf.el);

  // create resize handle and add it to the container
  const handle = resizeHandle(
    img,
    imgContainerWidth,
    shelf.props.lockRatio,
    shelf.props.units,
    shelf.sync,
    syncFromShelf,
  );
  container.append(handle);

  // return functions that can be used to update and detach the ui
  return {
    update: () => {
      shelf.sync();
    },
    detach: () => {
      container.classList.remove('pm-image-resize-active');
      clearInterval(containerWidthTimer);
      handle.remove();
      shelf.el.remove();
    },
  };
}

function resizeShelf(
  view: EditorView,
  img: HTMLImageElement,
  onInit: () => void,
  onWidthChanged: () => void,
  onHeightChanged: () => void,
  onUnitsChanged: () => void,
  onEditImage: () => void,
  translateText: (text: string) => string,
) {
  // create resize shelf
  const shelf = createPopup(view, ['pm-text-color']);

  // update shelf position to make sure it's visible
  const updatePosition = () => {
    const kShelfRequiredSize = 335;
    const editingNode = editingRootNode(view.state.selection);
    const editingEl = view.domAtPos(editingNode!.pos + 1).node as HTMLElement;
    const editingBox = editingEl.getBoundingClientRect();
    const imageBox = img.getBoundingClientRect();
    const positionLeft = imageBox.left + kShelfRequiredSize < editingBox.right;
    if (positionLeft) {
      shelf.style.left = '0';
      if (img.offsetWidth < kShelfRequiredSize) {
        shelf.style.right = img.offsetWidth - kShelfRequiredSize + 'px';
      } else {
        shelf.style.right = '';
      }
    } else {
      shelf.style.right = '0';
      if (img.offsetWidth < kShelfRequiredSize) {
        shelf.style.left = img.offsetWidth - kShelfRequiredSize + 'px';
      } else {
        shelf.style.left = '';
      }
    }
  };

  // always position below
  shelf.style.bottom = '-48px';

  // main panel that holds the controls
  const panel = createHorizontalPanel();
  shelf.append(panel);
  const addToPanel = (widget: HTMLElement, paddingRight: number) => {
    addHorizontalPanelCell(panel, widget);
    if (paddingRight) {
      const paddingSpan = window.document.createElement('span');
      paddingSpan.style.width = paddingRight + 'px';
      addHorizontalPanelCell(panel, paddingSpan);
    }
  };

  const inputClasses = ['pm-text-color', 'pm-background-color'];

  // width
  const wLabel = createInputLabel('w:');
  addToPanel(wLabel, 4);
  const wInput = createTextInput(4, inputClasses);
  wInput.onchange = onWidthChanged;
  addToPanel(wInput, 8);

  // height
  const kHeightWidth = '38px';
  const hLabel = createInputLabel('h:');
  addToPanel(hLabel, 4);
  const hInput = createTextInput(4, inputClasses, { width: kHeightWidth });
  hInput.onchange = onHeightChanged;
  addToPanel(hInput, 0);
  const hAutoLabel = createInputLabel('(auto)', ['pm-light-text-color'], { width: kHeightWidth });
  addToPanel(hAutoLabel, 10);

  // units
  const unitsSelect = createSelectInput(validUnits(), inputClasses);
  unitsSelect.onchange = () => {
    // drive focus to width and back to prevent wierd selection change
    // detection condition that causes PM to re-render the node the
    // next time we resize it
    wInput.focus();
    unitsSelect.focus();

    // manage UI
    manageUnitsUI();

    // notify client
    onUnitsChanged();
  };
  addToPanel(unitsSelect, 12);

  // lock ratio
  const checkboxWrapper = window.document.createElement('div');
  const lockCheckbox = createCheckboxInput();
  lockCheckbox.checked = true;
  checkboxWrapper.append(lockCheckbox);
  addToPanel(checkboxWrapper, 4);
  const lockLabel = createInputLabel(translateText('Lock ratio'));
  addToPanel(lockLabel, 20);

  // edit button
  const editImage = createImageButton(['pm-image-button-edit-properties'], translateText('Edit Image'));
  editImage.onclick = onEditImage;
  addHorizontalPanelCell(panel, editImage);

  // run onInit
  if (img.complete) {
    setTimeout(onInit, 0);
  } else {
    img.onload = onInit;
  }

  // function used to manage ui
  const manageUnitsUI = () => {
    const percentSizing = unitsSelect.value === '%';

    if (percentSizing) {
      lockCheckbox.checked = true;
      lockCheckbox.disabled = true;
    } else {
      lockCheckbox.disabled = false;
    }

    hInput.style.display = percentSizing ? 'none' : '';
    hAutoLabel.style.display = percentSizing ? '' : 'none';
  };
  manageUnitsUI();

  // helper function to get a dimension (returns null if input not currently valid)
  const getDim = (input: HTMLInputElement) => {
    const value = parseFloat(input.value);
    if (isNaN(value)) {
      return null;
    }
    if (value > 0) {
      return value;
    } else {
      return null;
    }
  };

  const setWidth = (width: number) => {
    wInput.value = roundUnit(width, unitsSelect.value);
  };
  const setHeight = (height: number) => {
    hInput.value = roundUnit(height, unitsSelect.value);
  };

  return {
    el: shelf,

    // sync the shelf props to the current size/units of the image
    // we don't sync to the node b/c we want to benefit from automatic
    // unit handling in the conversion to the DOM
    sync: () => {
      const size = shelfSizeFromImage(img);
      unitsSelect.value = size.unit;
      setWidth(size.width);
      setHeight(size.height);

      // manage units ui
      manageUnitsUI();

      // ensure we are positioned correctly (not offscreen, wide enough, etc.)
      updatePosition();
    },

    position: () => {
      updatePosition();
    },

    props: {
      width: () => getDim(wInput) || shelfSizeFromImage(img).width,
      setWidth,
      height: () => getDim(hInput) || shelfSizeFromImage(img).height,
      setHeight,
      units: () => unitsSelect.value,
      setUnits: (units: string) => (unitsSelect.value = units),
      lockRatio: () => lockCheckbox.checked,
      setLockRatio: (lock: boolean) => {
        if (!lockCheckbox.disabled) {
          lockCheckbox.checked = lock;
        }
      },
    },
  };
}

function shelfSizeFromImage(img: HTMLImageElement) {
  // get attributes
  const width = img.getAttribute('data-width');
  const height = img.getAttribute('data-height');

  // if there is no width and no height, then use pixels
  if (!width && !height) {
    return {
      width: img.offsetWidth,
      height: img.offsetHeight,
      unit: 'px',
    };

    // read units
  } else {
    let widthWithUnit = sizePropWithUnit(width);
    let heightWithUnit = sizePropWithUnit(height);

    if (!widthWithUnit) {
      widthWithUnit = {
        size: heightWithUnit!.size * (img.offsetWidth / img.offsetHeight),
        unit: heightWithUnit!.unit,
      };
    }

    if (!heightWithUnit) {
      heightWithUnit = {
        size: widthWithUnit.size * (img.offsetHeight / img.offsetWidth),
        unit: widthWithUnit.unit,
      };
    }

    return {
      width: widthWithUnit.size,
      height: heightWithUnit.size,
      unit: widthWithUnit.unit,
    };
  }
}

function resizeHandle(
  img: HTMLImageElement,
  imgContainerWidth: () => number,
  lockRatio: () => boolean,
  units: () => string,
  onSizing: () => void,
  onSizingComplete: () => void,
) {
  const handle = document.createElement('span');
  handle.classList.add('pm-image-resize-handle', 'pm-background-color', 'pm-selected-node-border-color');
  handle.style.position = 'absolute';
  handle.style.bottom = '-6px';
  handle.style.right = '-6px';
  handle.style.cursor = 'nwse-resize';

  const havePointerEvents = !!document.body.setPointerCapture;

  const onPointerDown = (ev: MouseEvent) => {
    ev.preventDefault();

    const startWidth = img.offsetWidth;
    const startHeight = img.offsetHeight;

    const startX = ev.pageX;
    const startY = ev.pageY;

    const containerWidth = imgContainerWidth();

    const onPointerMove = (e: MouseEvent) => {
      // detect pointer movement
      const movedX = e.pageX - startX;
      const movedY = e.pageY - startY;

      let width;
      let height;
      if (lockRatio()) {
        if (movedX >= movedY) {
          width = startWidth + movedX;
          height = startHeight + movedX * (startHeight / startWidth);
        } else {
          height = startHeight + movedY;
          width = startWidth + movedY * (startWidth / startHeight);
        }
      } else {
        width = startWidth + movedX;
        height = startHeight + movedY;
      }

      // set image width and height based on units currnetly in use
      img.style.width = width + 'px';
      img.setAttribute('data-width', pixelsToUnit(width, units(), containerWidth) + units());
      img.style.height = height + 'px';
      img.setAttribute('data-height', pixelsToUnit(height, units(), containerWidth) + units());

      onSizing();
    };

    const onPointerUp = (e: MouseEvent) => {
      e.preventDefault();

      // stop listening to events
      if (havePointerEvents) {
        handle.releasePointerCapture((e as PointerEvent).pointerId);
        handle.removeEventListener('pointermove', onPointerMove);
        handle.removeEventListener('pointerup', onPointerUp);
      } else {
        document.removeEventListener('mousemove', onPointerMove);
        document.removeEventListener('mouseup', onPointerUp);
      }

      // update image size
      onSizingComplete();
    };

    if (havePointerEvents) {
      handle.setPointerCapture((ev as PointerEvent).pointerId);
      handle.addEventListener('pointermove', onPointerMove);
      handle.addEventListener('pointerup', onPointerUp);
    } else {
      document.addEventListener('mousemove', onPointerMove);
      document.addEventListener('mouseup', onPointerUp);
    }
  };

  if (havePointerEvents) {
    handle.addEventListener('pointerdown', onPointerDown);
  } else {
    handle.addEventListener('mousedown', onPointerDown);
  }

  return handle;
}

function updateImageSize(
  view: EditorView,
  image: NodeWithPos,
  img: HTMLImageElement,
  width: number,
  height: number,
  unit: string,
) {
  // don't write pixels explicitly
  unit = unit === 'px' ? '' : unit;

  // edit width & height in keyvalue
  let keyvalue = extractSizeStyles(image.node.attrs.keyvalue as Array<[string, string]>)!;
  keyvalue = keyvalue.filter(value => !['width', 'height'].includes(value[0]));
  keyvalue.push(['width', width + unit]);
  if (!hasPercentWidth(width + unit) && !isNaturalAspectRatio(width, height, img, false)) {
    keyvalue.push(['height', height + unit]);
  }

  // create transaction
  const tr = view.state.tr;

  // set new attributes
  tr.setNodeMarkup(image.pos, image.node.type, { ...image.node.attrs, keyvalue });

  // restore node selection if our tr.setNodeMarkup blew away the selection
  const prevState = view.state;
  if (prevState.selection instanceof NodeSelection && prevState.selection.from === image.pos) {
    tr.setSelection(NodeSelection.create(tr.doc, image.pos));
  }

  // dispatch transaction
  view.dispatch(tr);
}
