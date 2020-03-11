var bitsy = window;

var editor3d = {
    CursorModes: {
        Add: 0,
        Remove: 1,
        Select: 2,
    },

    CursorColors: {
        Green: new BABYLON.Color3(0, 1, 0.5),
        Red: new BABYLON.Color3(1, 0.3, 0.3),
        Gray: new BABYLON.Color3(1, 1, 1),
    },

    // debug. set this when clicking on the mesh in select mode
    curSelectedMesh: null,

    groundMesh: null,

    // track what drawing is selected
    lastSelectedDrawing: null,

    camera: null,

    takeScreenshot: false,
};

editor3d.cursor = {
    mesh: null,
    roomX: null,
    roomY: null,
    curRoomId: undefined,
    isValid: false,
    mode: editor3d.CursorModes.Add,
    shouldUpdate: false,
    pickedMesh: null,
    isMouseDown: false,
    isAltDown: false,
    isShiftDown: false,
    // track if cursor mode was modified by holding down alt for switching to select mode
    modeBeforeModified: null,
    turnOn: function () {
        this.shouldUpdate = true;
    },
    turnOff: function () {
        this.shouldUpdate = false;
        this.isValid = false;
        this.mesh.isVisible = false;
    },
};

editor3d.init = function() {
    b3d.init();

    editor3d.suggestReplacingNameTags();

    editor3d.camera = b3d.createCamera({
        type: 'arc',
        name: 'EditorCamera',
        alpha: Math.PI * 1.5,
        beta: Math.PI / 3,
        radius: 26,
        target: {x:8, y:0, z:8},
        minZ: 0.001,
        maxZ: bitsy.mapsize * 5,
        wheelPrecision: bitsy.mapsize,
        upperRadiusLimit: 30,
        lowerRadiusLimit: 1,
        upperBetaLimit: Math.PI / 2,
        attachControl: true,
    });
    editor3d.camera.activate();

    // make a mesh for 3d cursor
    editor3d.cursor.mesh = BABYLON.MeshBuilder.CreateBox('cursor', { size: 1.1 }, b3d.scene);
    editor3d.cursor.mesh.isPickable = false;
    var cursorMat = new BABYLON.StandardMaterial("cursorMaterial", b3d.scene);
    cursorMat.ambientColor = editor3d.CursorColors.Green;
    cursorMat.alpha = 0.5;
    editor3d.cursor.mesh.material = cursorMat;

    // add ground floor mesh
    editor3d.groundMesh = BABYLON.MeshBuilder.CreatePlane('ground', {
        width: bitsy.mapsize,
        height: bitsy.mapsize,
    }, b3d.scene);
    b3d.transformGeometry(editor3d.groundMesh, BABYLON.Matrix.Translation(bitsy.mapsize/2 - 0.5, bitsy.mapsize/2 - 0.5, 0.5));
    b3d.transformGeometry(editor3d.groundMesh, BABYLON.Matrix.RotationX(Math.PI/2));
    var groundMat = new BABYLON.StandardMaterial('ground material', b3d.scene);
    groundMat.maxSimultaneousLights = 0;
    groundMat.freeze();
    groundMat.alpha = 0;
    editor3d.groundMesh.material = groundMat;

    // set the rendering loop function
    b3d.engine.runRenderLoop(editor3d.update);

    // add event listeners
    b3d.sceneCanvas.addEventListener('mouseover', function (e) {
        // register 3d cursor update & mouse picking
        editor3d.cursor.turnOn();
    });

    b3d.sceneCanvas.addEventListener('mouseleave', function (e) {
        // unregister 3d cursor update & mouse picking
        editor3d.cursor.turnOff();
    });

    // switch cursor mode when starting to hold alt and shift
    document.addEventListener('keydown', function(e) {
        switch (e.code) {
            case 'AltLeft':
            case 'AltRight':
                editor3d.cursor.isAltDown = true;
                if (editor3d.cursor.modeBeforeModified === null) {
                    editor3d.cursor.modeBeforeModified = editor3d.cursor.mode;
                    if (editor3d.cursor.isShiftDown) {
                        editor3d.cursor.mode = editor3d.CursorModes.Remove;
                    } else {
                        editor3d.cursor.mode = editor3d.CursorModes.Select;
                    }
                }
                break;
            case 'ShiftLeft':
            case 'ShiftRight':
                editor3d.cursor.isShiftDown = true;
                if (editor3d.cursor.isAltDown && editor3d.cursor.mode === editor3d.CursorModes.Select) {
                    editor3d.cursor.mode = editor3d.CursorModes.Remove;
                }
                break;
        }
    });

    // switch cursor mode with number keys and when releasing alt and shift
    document.addEventListener('keyup', function(e) {
        switch (e.code) {
            case 'AltLeft':
            case 'AltRight':
                editor3d.cursor.isAltDown = false;
                if (editor3d.cursor.modeBeforeModified !== null) {
                    editor3d.cursor.mode = editor3d.cursor.modeBeforeModified;
                    editor3d.cursor.modeBeforeModified = null;
                }
                break;
            case 'ShiftLeft':
            case 'ShiftRight':
                editor3d.cursor.isShiftDown = false;
                if (editor3d.cursor.isAltDown && editor3d.cursor.mode === editor3d.CursorModes.Remove) {
                    editor3d.cursor.mode = editor3d.CursorModes.Select;
                }
                break;
        }
    });

    b3d.scene.onPointerDown = function (e) {
        editor3d.cursor.isMouseDown = true;
    };

    b3d.scene.onPointerMove = function (e) {
        // don't update the cursor when moving the camera
        if (editor3d.cursor.shouldUpdate && editor3d.cursor.isMouseDown) {
            editor3d.cursor.turnOff();
        }
    };

    b3d.scene.onPointerUp = editor3d.onPointerUp;

    // update textures when pallete is changed
    bitsy.events.Listen('palette_change', function(event) {
        if (bitsy.paletteTool){
            b3d.clearCachesPalette(bitsy.paletteTool.GetSelectedId());
        }
        // console.log('palette change event hiya hey');
    });

    // update texture for the current drawing when editing with paint tool
    // this relies on event listeners being called in order
    // it should work in any browser that implements dom3 events
    // listen to the next mouseup event anywhere in the document to make sure
    // textures will get updated even if the stroke is finished outside of the canvas
    document.getElementById('paint').addEventListener('mousedown', function (e) {
        document.addEventListener('mouseup', editor3d.updateTextureOneTimeListener);
    });

    bitsy.events.Listen("game_data_change", function() {
        editor3d.reInit3dData();
    });

    // patch refreshGameData function to include 3d data
    b3d.patch(bitsy, 'refreshGameData', function () {
        b3d.serializeData();
    });

    // patch delete room function to fix crash when deleting rooms from vanilla room panel
    b3d.patch(bitsy, 'deleteRoom',
        function () {
            b3d._patchContext.deletedRoom = bitsy.curRoom;
        },
        function () {
            // check if the room was actually deleted after the dialog
            var deletedRoom = b3d._patchContext.deletedRoom;
            if (bitsy.curRoom !== deletedRoom) {
                b3d.unregisterRoomFromStack(deletedRoom);
                bitsy.refreshGameData();
            }
            delete b3d._patchContext.deletedRoom;
        }
    );

    // update b3d.meshConfig when drawings are added, duplicated and deleted
    ['newDrawing', 'duplicateDrawing'].forEach(function (f) {
        b3d.patch(bitsy, f, null, function () {
            var drawing = bitsy.drawing.getEngineObject();
            b3d.meshConfig[drawing.drw] = b3d.getDefaultMeshProps(drawing);
        });
    });
    b3d.patch(bitsy, 'deleteDrawing',
       function () {
            b3d._patchContext.deletedDrawingId = bitsy.drawing.getEngineObject().drw;
        },
        function () {
            delete b3d.meshConfig[b3d._patchContext.deletedDrawingId];
            delete b3d._patchContext.deletedDrawingId;
        }
    );

    // update drawing name in 3d settings panel when it's modified
    b3d.patch(bitsy, 'on_drawing_name_change', null, function () {
        document.getElementById('meshBaseName').innerHTML = meshPanel.getDrawingFullTitle(bitsy.drawing.getEngineObject());
    });

    // patch functions that are called when switching play mode on and off
    b3d.patch(bitsy, 'on_play_mode', null, function () {
        b3d.mainCamera.activate();
        document.getElementById('playModeWarning').style.display = 'block';
    });

    b3d.patch(bitsy, 'on_edit_mode', null, function () {
        editor3d.reInit3dData();
        editor3d.camera.activate();
        document.getElementById('playModeWarning').style.display = 'none';
    });

    // change the behavior of 'find drawing' panel to allow viewing drawings
    // of different types without automatically selecting a drawing of that type
    // this should be accompanied by the fix to 'selectPaint' function,
    // which doesn't work as a patch for some reason, so i had to modify bitsy source
    // also needed to make thumbnails draggable in 'explorer.js'
    // and fix a few other new bugs in 'paint.js' and 'editor.js'
    
    // replace 'find drawing' tab buttons callbacks so that they don't
    // automatically select a new drawing
    // this way 'find drawing' panel can be more useful for drag & drop
    document.getElementById('paintExplorerOptionAvatar').onclick = function() {
        if(bitsy.paintExplorer != null) { 
            bitsy.paintExplorer.Refresh(bitsy.TileType.Avatar);
        }
        document.getElementById("paintExplorerOptionAvatar").checked = true;
        document.getElementById("paintExplorerAdd").setAttribute("style","display:none;");
        document.getElementById("paintExplorerFilterInput").value = "";
    };

    document.getElementById('paintExplorerOptionTile').onclick = function() {
        bitsy.paintExplorer.Refresh(bitsy.TileType.Tile);
        document.getElementById("paintExplorerOptionTile").checked = true;
        document.getElementById("paintExplorerAdd").setAttribute("style","display:inline-block;");
        document.getElementById("paintExplorerFilterInput").value = "";
    };

    document.getElementById('paintExplorerOptionSprite').onclick = function() {
        bitsy.paintExplorer.Refresh(bitsy.TileType.Sprite);
        document.getElementById("paintExplorerOptionSprite").checked = true;
        document.getElementById("paintExplorerAdd").setAttribute("style","display:inline-block;");
        document.getElementById("paintExplorerFilterInput").value = "";
    };

    document.getElementById('paintExplorerOptionItem').onclick = function() {
        bitsy.paintExplorer.Refresh(bitsy.TileType.Item);
        document.getElementById("paintExplorerOptionItem").checked = true;
        document.getElementById("paintExplorerAdd").setAttribute("style","display:inline-block;");
        document.getElementById("paintExplorerFilterInput").value = "";
    };
    
}; // editor3d.init()

// clear caches to force textures and meshes to update
editor3d.updateTextureOneTimeListener = function(e) {
    b3d.clearCachesTexture(bitsy.paintTool.getCurObject().drw, bitsy.paintTool.curDrawingFrameIndex);
    // also clear mesh and materials caches to make sure meshes that use updated drawing as a replacement
    // will get updated too, instead of continuing to point to a deleted texture
    b3d.clearCaches([b3d.caches.mesh, b3d.caches.mat]);
    document.removeEventListener('mouseup', editor3d.updateTextureOneTimeListener);
};

editor3d.reInit3dData = function () {
    // since there is no way to tell what exactly was changed, reset everything
    // reset stack objects
    b3d.roomsInStack = {};
    b3d.stackPosOfRoom = {};
    b3d.meshConfig = {};

    // delete camera
    b3d.mainCamera.deactivate();
    b3d.mainCamera.ref.dispose();
    b3d.mainCamera = null;

    // reload data
    b3d.parseData();

    // set editor camera as active again
    editor3d.camera.activate();

    editor3d.suggestReplacingNameTags();
    // clear all caches to force all drawings to reset during the update
    b3d.clearCaches(Object.values(b3d.caches));
    // this fixes 3d editor crash when removing rooms right after modifying game data
    bitsy.selectRoom(bitsy.curRoom);

    // update 3d settings panel. will automatically switch to mesh tab
    meshPanel.updateAll();
};

editor3d.suggestReplacingNameTags = function () {
    // check if name tags are used and ask to delete them: new data format made them redundant 
    var nameTagsRegex = / ?#(stack|mesh|draw|r|t|s|transparent|children)\([^]*?\)/gm;
    var usesNameTags;
    Object.values(bitsy.names).forEach(function (namesMap) {
        namesMap.forEach(function (value, key) {
            usesNameTags = usesNameTags || nameTagsRegex.test(key);
        });
    });
    if (usesNameTags && window.confirm("3d editor uses new format for storing its data. it can read game data made for older versions of 3d hack that relied on name-tags, but it doesn't update existing name-tags when you make changes and prioritizes data in the new format when both kinds are present. you might want to delete name-tags to avoid confusion and make names less cluttered. do you want to delete them?")) {
        [].concat(Object.values(bitsy.room), Object.values(bitsy.tile), Object.values(bitsy.sprite), Object.values(bitsy.item))
        .forEach(function (entity) {
            if (entity.name) {
                entity.name = entity.name.replace(nameTagsRegex, '');
            }
        });
        bitsy.updateNamesFromCurData();
        bitsy.refreshGameData();
    }
};

// initialize 3d editor
document.addEventListener('DOMContentLoaded', function() {
    // hook up init function
    var s = bitsy.start;
    bitsy.start = function() {
        s.call();
        editor3d.init();
        // set up mesh panel ui after 3d editor data has been initialized
        meshPanel.init();
    };

    // insert new panels in default prefs
    bitsy.defaultPanelPrefs.workspace.forEach(function(panel) {
        if (panel.position > 0) {
            panel.position = panel.position + 2;
        }
    });
    bitsy.defaultPanelPrefs.workspace.splice(1, 0,
        { id:"room3dPanel", visible:true, position:1 },
        { id:"meshPanel", visible:true, position:2 }
    );
});

editor3d.addRoomToStack = function (roomId, stackId, pos) {
    var room = bitsy.room[roomId];
    // var tag = `#stack(${stackId},${pos})`;
    // room.name = room.name && ' ' + tag || tag;
    // bitsy.updateNamesFromCurData();
    b3d.registerRoomInStack(roomId, stackId, pos);
    bitsy.refreshGameData();
};

editor3d.newStackId = function () {
    // generate valid stack id
    // for now only use letters
    // this will ensure compatibility with current version of 3d hack

    function makeLetters(charCodes) {
        return charCodes.map(function(c) {
            return String.fromCharCode(c);
        }).join('');
    }

    function increment(arr, min, max) {
        for (var i = arr.length - 1; i >= 0; i--) {
            arr[i] = arr[i] + 1;
            if (arr[i] === max + 1) {
                if (i > 0) {
                    arr[i] = min;
                    continue;
                } else {            
                    var newLength = arr.length + 1;
                    for (var n = 0; n < newLength; n++) {
                        arr[n] = min;
                    }
                }
            }
            break;
        }
    }

    // charcodes from 97 to 122 represent letters from 'a' to 'z'
    var id = [97];
    while (Object.keys(b3d.roomsInStack).indexOf(makeLetters(id)) !== -1) {
        increment(id, 97, 122);
    }
    return makeLetters(id);
};

editor3d.onPointerUp = function (e) {
    editor3d.cursor.isMouseDown = false;
    // continue updating cursor after moving the camera
    editor3d.cursor.turnOn();

    // do editor actions logic here
    if (!editor3d.cursor.isValid) return;
    if (editor3d.cursor.mode === editor3d.CursorModes.Add) {
        // console.log('going to add new drawing now!');
        // console.log('curRoomId: ' + editor3d.cursor.curRoomId);
        // console.log(drawing);
        // return if there is no currently selected drawing
        if (!bitsy.drawing) return;

        if (!editor3d.cursor.curRoomId) {
            // see if the cursor points to an existing room or a new room should be added
            // if a new room should be added, create it and update the curRoomId on the cursor
            // also make sure new room is integrated in the current stack data

            // if current room is a stray room without a stack, new stack should be created
            // and the current room should be added to it
            if (!b3d.curStack) {
                b3d.curStack = editor3d.newStackId();
                editor3d.addRoomToStack(bitsy.curRoom, b3d.curStack, 0);
            }

            // note: this function sets bitsy.curRoom to newly created room
            bitsy.newRoom();
            var newRoomId = bitsy.curRoom;
            editor3d.addRoomToStack(newRoomId, b3d.curStack, editor3d.cursor.mesh.position.y);
            editor3d.cursor.curRoomId = newRoomId;
        }

        if (bitsy.drawing.type === bitsy.TileType.Tile) {
            // console.log('adding new tile');
            bitsy.room[editor3d.cursor.curRoomId].tilemap[editor3d.cursor.roomY][editor3d.cursor.roomX] = bitsy.drawing.id;
        } else if (bitsy.drawing.type === bitsy.TileType.Sprite || bitsy.drawing.type === bitsy.TileType.Avatar) {
            var s = bitsy.sprite[bitsy.drawing.id];
            s.room = editor3d.cursor.curRoomId;
            s.x = editor3d.cursor.roomX;
            s.y = editor3d.cursor.roomY;

            // if there already is a mesh for this sprite, move it accordingly
            var mesh = b3d.sprites[bitsy.drawing.id];
            if (mesh) {
                mesh.position = editor3d.cursor.mesh.position;
                // make sure to reapply additional transformation from tags
                // todo: won't be necessary soon
                // b3d.applyTransformTags(s, mesh);
                // update bitsyOrigin object to make sure mouse picking will work correctly
                mesh.bitsyOrigin.x = s.x;
                mesh.bitsyOrigin.y = s.y;
                mesh.bitsyOrigin.roomId = s.room;
            }
        } else if (bitsy.drawing.type === bitsy.TileType.Item) {
            bitsy.room[editor3d.cursor.curRoomId].items.push({
                id: bitsy.drawing.id,
                x: editor3d.cursor.roomX,
                y: editor3d.cursor.roomY,
            });
        }
        bitsy.selectRoom(editor3d.cursor.curRoomId);
        bitsy.refreshGameData();
    // if cursor mode is 'select' or 'remove' picked mesh is not falsy
    } else if (editor3d.cursor.pickedMesh) {
        // ref in global variable for debug
        editor3d.curSelectedMesh = editor3d.cursor.pickedMesh;

        // as the children tag currently does, assume that children can't be nested
        try {
            var bitsyOrigin = editor3d.cursor.pickedMesh.bitsyOrigin || editor3d.cursor.pickedMesh.parent.bitsyOrigin;
        } catch (err) {
            console.error("picked mesh doesn't have a bitsyOrigin");
            console.log(editor3d.cursor.pickedMesh);
            return;
        }

        console.log('bitsy origin:');
        console.log(bitsyOrigin);

        bitsy.selectRoom(bitsyOrigin.roomId);

        // i could infer what drawing it is from the position of the cursor
        // but there could be cases when a mesh can be pushed outside of its bitsy cell using transform tags
        // or when there are several rooms in the stack positioned at the same level
        // would be more robust to attach the data about it's exact bitsy context to the mesh object
        // when the mesh is created and read it here
        if (editor3d.cursor.mode === editor3d.CursorModes.Select) {
            // call the function that bitsy calls when alt-clicking
            // this function relies on bitsy.curRoom to find the drawing
            bitsy.editDrawingAtCoordinate(bitsyOrigin.x, bitsyOrigin.y);
        } else {
            // remove selected drawing from the room data or move sprite
            var id = bitsyOrigin.drawing.id;
            switch (bitsyOrigin.drawing.drw.slice(0, 3)) {
                case 'SPR':
                    if (bitsy.playerId === drawing.id) {
                        return;
                    }
                    bitsyOrigin.drawing.room = null;
                    bitsyOrigin.drawing.x = -1;
                    bitsyOrigin.drawing.y = -1;
                    // clean up 3d hack's 'b3d.sprites'
                    b3d.sprites[id].dispose();
                    b3d.sprites[id] = null;
                    delete b3d.sprites[id];
                    break;
                case 'ITM':
                    var roomItems = bitsy.room[bitsyOrigin.roomId].items;
                    var itemIndex = roomItems.findIndex(function(i) {
                        return i.id === id &&
                            i.x === bitsyOrigin.x &&
                            i.y === bitsyOrigin.y;
                    });
                    if (itemIndex !== -1) {
                        roomItems.splice(itemIndex, 1);
                    } else {
                        console.error("can't find an item to remove");
                        return;
                    }
                    break;
                case 'TIL':
                    bitsy.room[bitsyOrigin.roomId].tilemap[bitsyOrigin.y][bitsyOrigin.x] = '0';
                    break;
            }
            bitsy.refreshGameData();
        }
    }
    bitsy.roomTool.drawEditMap();
    bitsy.updateRoomName();
}; // editor3d.onPointerUp()

editor3d.updateCursor = function (pickInfo) {
    // assume that cursor isn't in the valid position unless it is proved to be different
    editor3d.cursor.isValid = false;
    editor3d.cursor.mesh.isVisible = false;
    editor3d.cursor.curRoomId = undefined;

    if (!pickInfo || !pickInfo.hit) return;
    var mesh = pickInfo.pickedMesh;
    var faceId = pickInfo.faceId;
    var point = pickInfo.pickedPoint;

    // var meshName = mesh.name || mesh.sourceMesh.source.name;
    // console.log('id: ' + mesh.id + ', source mesh: ' + meshName + ', faceId: ' + faceId);
    // console.log(mesh);

    if (editor3d.cursor.mode === editor3d.CursorModes.Add) {
        // console.log('cursor mode: add');
        editor3d.cursor.mesh.material.ambientColor = editor3d.CursorColors.Green;
        // figure out the normal manually, because babylon's built in method doesn't work for wedges
        // and possibly other custom meshes
        var normal = editor3d.getNormal(mesh, faceId);
        // console.log('face normal: ' + normal.asArray().map(i => ' ' + i.toFixed(1)));
        // console.log('picked point: ' + point.asArray().map(i => ' ' + i.toFixed(1)));

        // improve cursor resolution for floors, planes, billboards etc
        // so that it's always placed between the object you are hovering over and the camera
        // use dot product to find out if the normal faces in similar direction with the ray
        // and flip it if it does
        var dotProduct = BABYLON.Vector3.Dot(pickInfo.ray.direction, normal);
        var cursorPos = point.add(normal.scale(0.75 * -Math.sign(dotProduct)));

        var cursorPosRounded = BABYLON.Vector3.FromArray(cursorPos.asArray().map(function(i) {return Math.round(i);}));
        // console.log('cursorPosRounded: ' + cursorPosRounded);

        editor3d.cursor.mesh.position = cursorPosRounded;

        // figure out the corresponding bitsy cell
        editor3d.cursor.roomX = editor3d.cursor.mesh.position.x;
        editor3d.cursor.roomY = bitsy.mapsize - 1 - editor3d.cursor.mesh.position.z;
        // console.log('roomX: ' + editor3d.cursor.roomX + ' roomY: ' + editor3d.cursor.roomY);

        // make sure that the cursor isn't out of bounds
        // if it is, don't draw the 3d cursor and make sure drawing can't be added to the b3d.scene
        if (!(editor3d.cursor.roomX * (editor3d.cursor.roomX-15) <= 0) || !(editor3d.cursor.roomY * (editor3d.cursor.roomY-15) <= 0)) {
            // console.log("can't place the cursor: coordinates are out of bounds");
            return;
        }

        // figure out if there is an existing room in the stack at appropriate level
        editor3d.cursor.curRoomId = b3d.curStack && b3d.roomsInStack[b3d.curStack].find(function(roomId) {
            return b3d.stackPosOfRoom[roomId].pos === editor3d.cursor.mesh.position.y;
        }) || (editor3d.cursor.mesh.position.y === 0) && bitsy.curRoom;

        // console.log('editor3d.cursor.curRoomId: ' + editor3d.cursor.curRoomId);

        // if the cursor resolves into an existing room,
        // check if the space in this room is already occupied
        // check if there is an empty space for a tile and for item/sprite
        // return depending on what type of the drawing is currently selected as a brush
        if (editor3d.cursor.curRoomId && !editor3d.canPlaceDrawing(room[editor3d.cursor.curRoomId], editor3d.cursor.roomX, editor3d.cursor.roomY)) {
            // console.log("can't place the cursor: the cell isn't empty");
            return;
        }

        editor3d.cursor.isValid = true;
        editor3d.cursor.mesh.isVisible = true;

    } else if (editor3d.cursor.mode === editor3d.CursorModes.Remove || editor3d.cursor.mode === editor3d.CursorModes.Select) {
        if (editor3d.cursor.mode === editor3d.CursorModes.Remove) {
            // console.log('cursor mode: remove');
            editor3d.cursor.mesh.material.ambientColor = editor3d.CursorColors.Red;
        } else if (editor3d.cursor.mode === editor3d.CursorModes.Select) {
            // console.log('cursor mode: select');
            editor3d.cursor.mesh.material.ambientColor = editor3d.CursorColors.Gray;
        }

        editor3d.cursor.mesh.position = mesh.absolutePosition;

        editor3d.cursor.pickedMesh = mesh;

        editor3d.cursor.isValid = true;
        editor3d.cursor.mesh.isVisible = true;
    }
}; // editor3d.updateCursor()

editor3d.canPlaceDrawing = function (room, x, y) {
    // use 3d hack's 'b3d.sprites' object that already keeps track of
    // all b3d.sprites that are currently in the b3d.scene
    if (bitsy.drawing.type === TileType.Tile) {
        return room.tilemap[y][x] === '0';
    } else {
        return !room.items.find(function(i) {return i.x === x && i.y === y;}) &&
            !Object.keys(b3d.sprites).find(function(id) {
                var s = bitsy.sprite[id]
                return s.room === room.id && s.x === x && s.y === y;
            });
    }
};

editor3d.getNormal = function (mesh, faceId) {
    var indices = mesh.getIndices();
    var i0 = indices[faceId * 3];
    var i1 = indices[faceId * 3 + 1];
    var i2 = indices[faceId * 3 + 2];

    // console.log('indices: ' + i0 + ', ' + i1 + ', ' + i2);
    // now get the vertices
    // console.log('data kinds:');
    // console.log(mesh.getVerticesDataKinds());

    var vertexBuf = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind, false);
    // console.log('vertexBuf:');
    // console.log(vertexBuf);

    // TODO:
    // gotta optimize this a big deal
    // since it would be an operation to be preformed quite frequently
    // perhaps cache it or store normal data for each mesh when they are added to the b3d.scene
    // i wonder what would be faster
    // if i still would call it every time at least reuse the vectors instead of creating new ones
    // or use variables for each number. idk what would be more effecient. would be interesting to run tests
    // or just attach the normal data to every mesh as an array where indices are the facet indices
    // and elements are Vector3. like mesh.faceNormals[0] would correspond to faceId 0 and so on
    var p0 = new BABYLON.Vector3(vertexBuf[i0 * 3], vertexBuf[i0 * 3 + 1], vertexBuf[i0 * 3 + 2]);
    var p1 = new BABYLON.Vector3(vertexBuf[i1 * 3], vertexBuf[i1 * 3 + 1], vertexBuf[i1 * 3 + 2]);
    var p2 = new BABYLON.Vector3(vertexBuf[i2 * 3], vertexBuf[i2 * 3 + 1], vertexBuf[i2 * 3 + 2]);

    // console.log('points: ' + p0 + ', ' + p1 + ', ' + p2);
    // console.log(p0);

    // if i'm going to reuse them use subtractToRef(otherVector: DeepImmutable<Vector3>, result: Vector3): Vector3
    var tempVec0 = p0.subtract(p1);
    var tempVec1 = p0.subtract(p2);

    // var normal = tempVec0.cross(tempVec1);
    // wtf... Vector3.cross is undefined even though it's in documentation
    // this is so fucking weird and frustrating
    // hopefully the static version will work
    // tempVec1, tempVec0 order seems to be correct
    var normal = BABYLON.Vector3.Cross(tempVec1, tempVec0);
    normal.normalize();

    BABYLON.Vector3.TransformNormalToRef(normal, mesh.getWorldMatrix(), normal);
    // console.log('transformed by world matrix: ' + normal);

    return normal;
}; // editor3d.getNormal()

editor3d.getDrawingFromDrw = function (drw) {
    var type;
    switch (drw.slice(0,3)) {
        case 'SPR':
            type = 'sprite';
            break;
        case 'TIL':
            type = 'tile';
            break;
        case 'ITM':
            type = 'item';
            break;
    }
    return bitsy[type][drw.slice(4)];
};

editor3d.update = function () {
    b3d.update();

    // update cursor
    if (!bitsy.isPlayMode && editor3d.cursor.shouldUpdate) {
        editor3d.updateCursor(b3d.scene.pick(
            b3d.scene.pointerX, b3d.scene.pointerY,
            function(m) {
                if (editor3d.cursor.mode !== editor3d.CursorModes.Add) {
                    return m.isVisible && m.isPickable && m !== editor3d.groundMesh;
                } else {
                    return m.isVisible && m.isPickable;
                }
            }));
    }

    b3d.render();

    // screenshots
    if (editor3d.takeScreenshot) {
        var link = document.createElement("a");
        link.download = bitsy.title + '.png';
        link.href = b3d.sceneCanvas.toDataURL();
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        delete link;

        editor3d.takeScreenshot = false;
    }

    // check for changes in the environment and update ui
    if (editor3d.lastSelectedDrawing !== bitsy.drawing.getEngineObject()) {
        editor3d.lastSelectedDrawing = bitsy.drawing.getEngineObject();
        // console.log('NEW DRAWING WAS SELECTED');
        meshPanel.updateSelection();
    }
};

// UI
// controls for editor panel
var room3dPanel = {
    selectAdjacent: function(direction) {
        // direction should be 1 or -1
        // get every first room from every stack and then every stray room
        // and make a list of all rooms we can switch between
        var eligibleRooms = Object.values(b3d.roomsInStack)
            .map(function(roomList) {
                return roomList[0]; 
            })
            .concat(Object.keys(bitsy.room).filter(function(roomId){
                return !b3d.stackPosOfRoom[roomId];
            }));
        var curIdx;
        if (b3d.curStack) {
            curIdx = Object.keys(b3d.roomsInStack).indexOf(b3d.curStack);
        } else {
            curIdx = eligibleRooms.indexOf(bitsy.curRoom);
        }
        var nextIdx = (curIdx + direction) % eligibleRooms.length;
        if (nextIdx < 0) {
            nextIdx = eligibleRooms.length - 1;
        }
        bitsy.selectRoom(eligibleRooms[nextIdx]);
    },

    duplicate: function() {
        var roomList = b3d.curStack && b3d.roomsInStack[b3d.curStack] || [bitsy.curRoom];
        b3d.curStack = b3d.curStack && editor3d.newStackId() || null;
        roomList.forEach(function(roomId) {
            bitsy.selectRoom(roomId);
            try {
                bitsy.duplicateRoom();
            } catch (err) {
                // todo: fix that bug in bitsy code? idk
            }
            if (b3d.curStack) {
                editor3d.addRoomToStack(bitsy.curRoom, b3d.curStack, b3d.stackPosOfRoom[roomId].pos);
            }
        });
    },

    delete: function() {
        if (b3d.curStack) {
            if (Object.keys(b3d.roomsInStack).length <= 1 ) {
                alert("You can't delete your only stack!");
                return;
            } else if (!confirm("Are you sure you want to delete this room stack? You can't get it back.")) {
                return;
            }
            // make a copy of the list of rooms to be deleted
            var roomList = b3d.roomsInStack[b3d.curStack].slice();
            roomList.forEach(function(roomId) {
                // delete exits in _other_ rooms that go to this room
                for(r in bitsy.room ) {
                    if(r != roomId) {
                        for(i in bitsy.room[r].exits) {
                            if(bitsy.room[r].exits[i].dest.room === roomId) {
                                bitsy.room[r].exits.splice( i, 1 );
                            }
                        }
                    }
                }
                delete room[roomId];
                b3d.unregisterRoomFromStack(roomId);
            });
            bitsy.refreshGameData();

            bitsy.markerTool.Clear();
            // will it work?
            room3dPanel.selectAdjacent(1);

            bitsy.roomTool.drawEditMap();
            bitsy.paintTool.updateCanvas();
            bitsy.updateRoomPaletteSelect();
            bitsy.markerTool.Refresh();
        } else {
            bitsy.deleteRoom();
        }
    },
}; // room3dPanel

// set up and respond to ui elements in mesh panel
var meshPanel = {
    // drw of the drawing that the changes should be applied to
    // can refer to base mesh or one of the children
    curDrw: null,

    subTypePrefixes: ['tower'],
    typeSelectEl: null,
    subTypeSelectEl: null,

    transparencyCheckEl: null,

    // this order corresponds with the order of values in serizlized transform
    transformElementNamesOrdered: [
        'transformScaleX', 'transformScaleY', 'transformScaleZ',
        'transformRotationX', 'transformRotationY', 'transformRotationZ',
        'transformTranslationX', 'transformTranslationY', 'transformTranslationZ' ],
    transformInputEls: [],
    transformValidatedNumbers: [1,1,1, 0,0,0, 0,0,0],

    cameraSettingsControllers: [],
    gameSettingsControllers: [],

    init: function() {
        meshPanel.typeSelectEl = document.getElementById('meshTypeSelect');
        meshPanel.subTypeSelectEl = document.getElementById('meshSubTypeSelect');
        meshPanel.transparencyCheckEl = document.getElementById('meshTransparencyCheck');

        // find transform input elements
        meshPanel.transformElementNamesOrdered.forEach(function (id) {
            meshPanel.transformInputEls.push(document.getElementById(id));
        });
        meshPanel.transformInputEls.forEach(function (el) {
            el.addEventListener('input', meshPanel.onChangeTransform);
            el.addEventListener('change', function (event) {
                var index = meshPanel.transformElementNamesOrdered.indexOf(event.target.id);
                event.target.value = meshPanel.transformValidatedNumbers[index];
            });
        });

        // set up type selection
        Object.keys(b3d.meshTemplates).forEach(function(templateName) {
            // check if the template name needs to be broken down between two select elements
            meshPanel.subTypePrefixes.forEach(function(p) {
                if (templateName.startsWith(p)) {
                    var suffix = templateName.slice(p.length);
                    var option = document.createElement('option');
                    option.text = option.value = suffix;
                    meshPanel.subTypeSelectEl.add(option);
                    templateName = p;
                }
            });
            
            if (Array.prototype.some.call(meshPanel.typeSelectEl.options, function(o) {return o.text === templateName;})) {
                return;
            }

            var option = document.createElement('option');
            option.text = option.value = templateName;

            meshPanel.typeSelectEl.add(option);
            // todo: set an option as currently selected depending on currently selected drawing
            // abstract into a separate function
            // since this would need to be updated whenever a different drawing is selected
            // option.selected = true;
        });

        meshPanel.updateSelection();

        meshPanel.onToggleTransform();

        meshPanel.initCameraSettings();
        meshPanel.toggleAdvancedCameraSettings();
        meshPanel.initGameSettings();

        // select and update base mesh tab
        meshPanel.onTabMesh();
    },

    // update widgets. they will reflect meshPanel.curDrw
    updateMeshConfigWidgets: function() {
        meshPanel.updateType();
        meshPanel.updateTransparency();
        meshPanel.updateTransform();
    },

    onTabMesh: function() {
        // make sure the correct tab is checked
        document.getElementById('settings3dTabMesh').checked = true;
        document.getElementById('settings3dMesh').style.display = 'block';
        document.getElementById('settings3dCamera').style.display = 'none';
        document.getElementById('settings3dGame').style.display = 'none';

        meshPanel.onTabBase();
    },

    onTabCamera: function() {
        // make sure the correct tab is checked
        document.getElementById('settings3dTabCamera').checked = true;
        document.getElementById('settings3dMesh').style.display = 'none';
        document.getElementById('settings3dCamera').style.display = 'block';
        document.getElementById('settings3dGame').style.display = 'none';

        meshPanel.updateCameraSettings();
    },

    onTabGame: function() {
        // make sure the correct tab is checked
        document.getElementById('settings3dTabGame').checked = true;
        document.getElementById('settings3dCamera').style.display = 'none';
        document.getElementById('settings3dMesh').style.display = 'none';
        document.getElementById('settings3dGame').style.display = 'block';

        meshPanel.updateGameSettings();
    },

    // update mesh settings and make sure base mesh tab is selected
    onTabBase: function() {
        document.getElementById('meshTabBase').checked = true;

        document.getElementById('meshChildrenList').style.display = 'none';
        document.getElementById('meshAddChildArea').style.display = 'none';

        // make sure mesh config is shown
        document.getElementById('meshConfig').style.display = 'block';

        // update mesh config options to reflect the base mesh
        var drawing = bitsy.drawing.getEngineObject();
        meshPanel.curDrw = drawing.drw;
        document.getElementById('meshBaseName').innerHTML = meshPanel.getDrawingFullTitle(drawing);

        meshPanel.updateMeshConfigWidgets();
    },

    onTabChildren: function() {
        // make sure the correct tab is checked
        document.getElementById('meshTabChildren').checked = true;

        meshPanel.updateChildrenList();

        // display different things depending on whether there are any children in the list
        var drawing = bitsy.drawing.getEngineObject();
        if (b3d.meshConfig[drawing.drw].children && b3d.meshConfig[drawing.drw].children.length > 0) {
            // if this mesh has children
            document.getElementById('meshChildrenList').style.display = 'block';

            // display add child button
            document.getElementById('meshAddChildButton').style.display = 'block';
            document.getElementById('meshAddChildArea').style.display = 'none';

            // display mesh config
            document.getElementById('meshConfig').style.display = 'block';
        } else {
            // if it doesn't have children, hide mesh config and only display add child area
            document.getElementById('meshChildrenList').style.display = 'none';
            document.getElementById('meshConfig').style.display = 'none';
            document.getElementById('meshAddChildArea').style.display = 'block';
        }
    },

    // removes old elements, creates new child elements and selects the last child element
    updateChildrenList: function() {
        // remove old elements
        var childrenList = document.getElementById('meshChildrenList');
        while (true) {
            var curEl = childrenList.firstChild;
            if (curEl.id === 'meshAddChildButton') {
                break;
            } else {
                curEl.parentNode.removeChild(curEl);
            }
        }
        // make new elements
        var children = b3d.meshConfig[bitsy.drawing.getEngineObject().drw].children;
        if (children && children.length > 0) {
            children.forEach(meshPanel.addSelectChildEl);
            meshPanel.updateMeshConfigWidgets();
        }
    },

    addSelectChildEl: function(drawing) {
        // add new child element. it will be checked by default
        // and selected as current drawing for editing mesh configuration
        var childrenList = document.getElementById('meshChildrenList');
        
        var divEl = document.createElement('div');
        var inputEl = document.createElement('input');
        var labelEl = document.createElement('label');
        var spanEl = document.createElement('span');

        childrenList.insertBefore(divEl, document.getElementById('meshAddChildButton'));
        divEl.appendChild(inputEl);
        divEl.appendChild(labelEl);
        labelEl.appendChild(spanEl);

        var inputId = 'childMesh' + drawing.drw;        
        labelEl.htmlFor = inputId;
        spanEl.innerHTML = meshPanel.getDrawingFullTitle(drawing);
        
        // set up radio button element and mark it as checked
        Object.assign(inputEl, {type: 'radio', name: 'children list', value: drawing.drw, id: inputId, onclick: meshPanel.selectChild, checked: true});
        // select drawing as current
        meshPanel.curDrw = drawing.drw;

        // make delete button
        var deleteButton = document.createElement('button');
        deleteButton.setAttribute('class', 'color0');
        deleteButton.setAttribute('style', 'margin-top: 2px; margin-left: 2px;');
        Object.assign(deleteButton, {value: drawing.drw, title: 'delete child mesh', onclick: meshPanel.deleteChild});
        deleteButton.innerHTML = '<i class="material-icons">remove_circle</i>';
        divEl.appendChild(deleteButton);
    },

    selectChild: function(event) {
        // hide add child area and display a button
        document.getElementById('meshAddChildArea').style.display = 'none';
        document.getElementById('meshAddChildButton').style.display = 'block';
        document.getElementById('meshConfig').style.display = 'block';

        // the child radio button will be marked as checked by the click
        // also select the respective drawing as current
        meshPanel.curDrw = event.target.value;
        console.log('selected child: ' + meshPanel.curDrw);

        meshPanel.updateMeshConfigWidgets();
    },

    // when pressing a plus sign button that expands into a drag & drop area
    onAddChildButton: function(event) {
        // console.log('deleted child: ' + event.target.value);
        document.getElementById('meshConfig').style.display = 'none';
        document.getElementById('meshAddChildArea').style.display = 'block';
        document.getElementById('meshAddChildButton').style.display = 'none';
    },

    addChild: function(drw) {
        var baseDrawing = bitsy.drawing.getEngineObject();
        var childDrawing = editor3d.getDrawingFromDrw(drw);
        // add child to 3d data
        b3d.meshConfig[baseDrawing.drw].children = b3d.meshConfig[baseDrawing.drw].children || [];
        b3d.meshConfig[baseDrawing.drw].children.push(childDrawing);
        // add child to ui and select both its ui element as and its data as a current editing target
        meshPanel.addSelectChildEl(childDrawing);
        meshPanel.updateMeshConfigWidgets();
        // update 3d scene
        b3d.clearCachesMesh(baseDrawing.drw);
        // update serialized data
        bitsy.refreshGameData();
    },

    deleteChild: function(event) {
        event.preventDefault();

        // delete child from 3d data
        var baseDrw = bitsy.drawing.getEngineObject().drw;
        // 'this' will be set to delete button element
        var childDrw = this.value;
        b3d.meshConfig[baseDrw].children = b3d.meshConfig[baseDrw].children.filter(function(childDrawing) {
            return childDrawing.drw !== childDrw;
        });
        
        // update 3d scene
        b3d.clearCachesMesh(childDrw);
        b3d.clearCachesMesh(baseDrw);
        // update serialized data
        bitsy.refreshGameData();
        // update ui
        meshPanel.updateChildrenList();
        meshPanel.onTabChildren();
    },

    getDrawingFullTitle: function(drawing) {
        var title = '';
        switch (drawing.drw.slice(0,3)) {
            case 'SPR':
                title = 'sprite';
                break;
            case 'TIL':
                title = 'tile';
                break;
            case 'ITM':
                title = 'item';
                break;
        }
        title = title + ' ' + drawing.id;
        if (drawing.name) {
            title = title + ': ' + drawing.name;
        }
        return title;
    },

    updateAll: function () {
        meshPanel.onTabBase();
        meshPanel.updateCameraSettings();
        meshPanel.updateGameSettings();
    },

    // to be called when another drawing is selected
    updateSelection: function () {
        meshPanel.onTabMesh();
    },

    updateType: function () {
        var type = b3d.meshConfig[meshPanel.curDrw].type;
        var prefix = meshPanel.subTypePrefixes.find(function (a) {return type.indexOf(a) !== -1});
        if (prefix) {
            var suffix = type.slice(prefix.length);
            Array.prototype.find.call(meshPanel.typeSelectEl.options, function(o) {return o.value === prefix}).selected = true;
            Array.prototype.find.call(meshPanel.subTypeSelectEl.options, function(o) {return o.value === suffix}).selected = true;
            meshPanel.subTypeSelectEl.style.display = 'initial';
        } else {
            Array.prototype.find.call(meshPanel.typeSelectEl.options, function(o) {return o.value === type}).selected = true;
            meshPanel.subTypeSelectEl.style.display = 'none';
        }
    },

    onChangeType: function() {
        var curMeshType = meshPanel.typeSelectEl.value;

        meshPanel.subTypePrefixes.forEach(function(p) {
            if (curMeshType.startsWith(p)) {
                meshPanel.subTypeSelectEl.style.display = 'initial';
                curMeshType += meshPanel.subTypeSelectEl.value;
            } else {
                meshPanel.subTypeSelectEl.style.display = 'none';
            }
        });

        b3d.meshConfig[meshPanel.curDrw].type = curMeshType;
        b3d.clearCachesMesh(meshPanel.curDrw);
        bitsy.refreshGameData();
    },

    updateTransparency: function() {
        meshPanel.transparencyCheckEl.checked = b3d.meshConfig[meshPanel.curDrw].transparency;
    },

    onChangeTransparency: function() {
        b3d.meshConfig[meshPanel.curDrw].transparency = meshPanel.transparencyCheckEl.checked;
        b3d.clearCachesTexture(meshPanel.curDrw);
        b3d.clearCaches([b3d.caches.mesh, b3d.caches.mat]);
        // b3d.clearCaches(Object.values(b3d.caches));
        bitsy.refreshGameData();
    },

    onToggleTransform: function() {
        if ( document.getElementById('transformCheck').checked ) {
            document.getElementById('transform').setAttribute('style','display:block;');
            document.getElementById('transformCheckIcon').innerHTML = 'expand_more';
        } else {
            document.getElementById('transform').setAttribute('style','display:none;');
            document.getElementById('transformCheckIcon').innerHTML = 'expand_less';
        }
    },

    updateTransform: function (argument) {
        var transform = b3d.meshConfig[meshPanel.curDrw].transform;
        if (transform) {
            meshPanel.transformValidatedNumbers = b3d.serializeTransform(transform);
        } else {
            meshPanel.transformValidatedNumbers = [1,1,1, 0,0,0, 0,0,0];
        }
        meshPanel.transformInputEls.forEach(function (el, i) {
            el.value = meshPanel.transformValidatedNumbers[i];
        });
    },

    // to be called whenever the value of any of the transform input elements is changed by the user
    onChangeTransform: function (event) {
        var index = meshPanel.transformElementNamesOrdered.indexOf(event.target.id);
        var defaultVal = event.target.id.indexOf('Scale') !== -1? 1: 0;
        // only allows 5 digits after decimal point: this will be serialized consistently
        meshPanel.transformValidatedNumbers[index] = meshPanel.validateInputElementAsNumber(event.target, defaultVal, 5);
        
        b3d.meshConfig[meshPanel.curDrw].transform = b3d.transformFromArray(meshPanel.transformValidatedNumbers);

        // force mesh instances to be recreated with the new transform by clearing the cache
        b3d.clearCachesMesh(meshPanel.curDrw);

        bitsy.refreshGameData();
    },

    // sets input element value to a valid in-progress string and returns a validated number
    validateInputElementAsNumber: function (el, defaultVal, digitsAfterDecimal) {
        // depending on the user input there could be different combinations
        // of what is displayed in the input element and what is stored
        // as a valid input to be used for updating actual game data
        // * if input is an empty string, minus sign or dot, show it as it is but store default value
        // * if input is NaN, store and show default value
        // * if input is a number, show it with a specified number of digits after decimal point
        var result;
        if (['', '-', '.', '-.'].indexOf(el.value) !== -1) {
            result = defaultVal;
        } else if (isNaN(el.value)) {
            result = el.value = defaultVal;
        } else {
            var dotIndex = el.value.indexOf('.');
            if (digitsAfterDecimal && dotIndex !== -1) {
                // only allows a set number of digits after a decimal point
                result = el.value = el.value.slice(0, dotIndex) + el.value.slice(dotIndex, dotIndex + digitsAfterDecimal + 1);
            } else {
                result = el.value;
            }
        }
        return Number(result);
    },

    addChildDropHandler: function (event) {
        event.preventDefault();
        const data = event.dataTransfer.getData("text/plain");
        console.log('dropped a child: ' + data);

        document.getElementById('meshAddChildArea').style.display = 'none';
        document.getElementById('meshChildrenList').style.display = 'block';
        document.getElementById('meshAddChildButton').style.display = 'block';
        document.getElementById('meshConfig').style.display = 'block';

        meshPanel.addChild(data);
    },

    addChildDragoverHandler: function (event) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "link";
        console.log('addChildDragoverHandler');
    },

    // generate ui for selected 3d game settings
    initGameSettings: function () {
        Object.keys(b3d.settings).filter(function (key){
            return ['clearColor', 'fogColor', 'tweenFunction'].indexOf(key) === -1
        })
        .forEach(function (key) {
        // ['engineWidth', 'engineHeight', 'engineAutoResize'].forEach(function (key) {
            var controller = new meshPanel.PropertyUIController(
                key, b3d.settings[key],
                document.getElementById('settings3dGame'),
                function (event) { b3d.applySettings(); }
            );
            controller.update(b3d.settings);
            meshPanel.gameSettingsControllers.push(controller);
        });
        // add a dropdown menu for tween functions
        var div = document.createElement('div');
        document.getElementById('settings3dGame').appendChild(div);
        var label = document.createElement('label');
        div.appendChild(label);
        label.innerHTML = 'tween function: ';
        var select = document.createElement('select');
        select.id = 'settings3dTweenFunction';
        div.appendChild(select);
        Object.keys(b3d.tweenFunctions).forEach(function(tweenName) {
            var option = document.createElement('option');
            option.text = option.value = tweenName;
            select.add(option);
            if (b3d.settings.tweenFunction === tweenName) {
                option.selected = true;
            }
        });
        select.onchange = function (event) {
            console.log('select onchange: ' + event.target.value);
            b3d.settings.tweenFunction = event.target.value;
            bitsy.refreshGameData();
        }
    },

    updateGameSettings: function () {
        document.getElementById('settings3dTweenFunction').value = b3d.settings.tweenFunction;
        meshPanel.gameSettingsControllers.forEach(function (controller) {
            controller.update(b3d.settings);
        });
    },

    toggleAdvancedCameraSettings: function (event) {
        if (document.getElementById('settings3dCameraAdvancedCheck').checked) {
            document.getElementById('settings3dCameraAdvanced').style.display = 'block';
            document.getElementById("cameraAdvancedSettingsCheckIcon").innerHTML = "expand_more";
        } else {
            document.getElementById('settings3dCameraAdvanced').style.display = 'none';
            document.getElementById("cameraAdvancedSettingsCheckIcon").innerHTML = "expand_less";
        }
    },

    initCameraSettings: function () {
        // generate option element for each preset
        Object.keys(b3d.cameraPresets).forEach(function(presetName) {
            var option = document.createElement('option');
            option.text = option.value = presetName;
            document.getElementById('settings3dCameraPreset').add(option);
            // todo: select the correct camera preset option 
            if (b3d.curCameraPreset === presetName) {
                option.selected = true;
            }
        });
        if (!b3d.curCameraPreset) document.getElementById('settings3dCameraPreset').value = 'custom';
        // todo: perhaps only add 'custom' option dynamically, when you modify one of the presets

        // generate ui for camera properties
        // generate options for camera type
        Object.keys(b3d.cameraDataModel.cameraTypes).forEach(function(typeName) {
            var option = document.createElement('option');
            option.text = option.value = typeName;
            document.getElementById('settings3dCameraType').add(option);
            if (b3d.mainCamera.type === typeName) {
                option.selected = true;
            }
        });

        // generate ui for other properties
        // get the list of all possible camera properties
        //  arrange properties in this order: traits, values, vectors
        var allCameraProps = {};
        ['trait', 'value', 'vector3'].forEach(function (propType) {
            Object.entries(b3d.cameraDataModel.commonProperties[propType] || {}).forEach(function (propEntry) {
                allCameraProps[propEntry[0]] = propEntry[1];
            });
            Object.values(b3d.cameraDataModel.cameraTypes).forEach(function (cameraTypeObj) {
                Object.entries(cameraTypeObj[propType] || {}).forEach(function (propEntry) {
                    allCameraProps[propEntry[0]] = propEntry[1];
                });
            });
        });

        Object.keys(allCameraProps).forEach(function (key) {
            var controller = new meshPanel.PropertyUIController(
                key, allCameraProps[key],
                document.getElementById('settings3dCameraAdvanced'),
                function (evt) { meshPanel.makeCameraPresetCustom(); },
            );

            // customize specific properties
            // display angles in degrees
            if (['alpha', 'beta', 'upperBetaLimit', 'lowerBetaLimit'].indexOf(key) !== -1) {
                controller.convertFromData = function (a) { return Number(a) * 180 / Math.PI; };
                controller.convertToData = function (a) { return Number(a) * Math.PI / 180; };
            } else if (key === 'rotation') {
                controller.nestedControllers.forEach(function (c) {
                    c.convertFromData = function (a) { return Number(a) * 180 / Math.PI; };
                    c.convertToData = function (a) { return Number(a) * Math.PI / 180; };
                });
            }
            controller.update(b3d.mainCamera);

            meshPanel.cameraSettingsControllers.push(controller);
        });
        
    },

    PropertyUIController: function (boundPropertyName, defaultPropertyValue, elementParent, onInput) {
        this.internalValue = null;
        this.nestedControllers = [];

        // bound object will be set through update method
        this.boundObject = null;
        this.boundPropertyName = boundPropertyName;
        this.defaultPropertyValue = defaultPropertyValue;
        this.elementParent = elementParent;
        this.onInput = onInput;
        
        this.validate = function () {return this.elementInput.value;};
        this.convertToData = function (a) {return a;};
        this.convertFromData = function (a) {return a;};

        this.elementDiv = document.createElement('div');
        this.elementParent.appendChild(this.elementDiv);
        
        this.elementLabel = document.createElement('label');
        this.elementDiv.appendChild(this.elementLabel);
        this.elementLabel.innerHTML = this.boundPropertyName.replace(/([A-Z])/g, " $1" ).toLowerCase() + ': ';

        if (typeof this.defaultPropertyValue === 'object') {
            // create nested controllers recursively
            Object.keys(this.defaultPropertyValue).forEach(function (key, idx) {
                // bound objects will be set through update method
                this.nestedControllers.push(
                    new meshPanel.PropertyUIController(key, this.defaultPropertyValue[key], this.elementDiv, this.onInput)
                );
                // add a margin
                this.nestedControllers[idx].elementDiv.style.marginLeft = '10px';
            }, this);
        } else {
            // create input element
            this.elementInput = document.createElement('input');
            this.elementDiv.appendChild(this.elementInput);

            // customize input elements for different data types
            if (typeof this.defaultPropertyValue === 'number') {
                this.validate = meshPanel.validateInputElementAsNumber.bind(null, this.elementInput, 0, 5);
                this.convertToData = function (a) { return Number(a); };
            } else if (typeof this.defaultPropertyValue === 'boolean') {
                this.elementInput.type = 'checkbox';
                this.elementInput.style.display = 'inline';
            }

            var thisController = this;
            this.elementInput.addEventListener('input', function (evt) {
                if (!thisController.boundObject) return;
                if (this.type === 'checkbox') {
                    thisController.boundObject[thisController.boundPropertyName] = this.checked;
                } else {
                    thisController.internalValue = thisController.validate()
                    thisController.boundObject[thisController.boundPropertyName] = thisController.convertToData(thisController.internalValue);
                }
                if (thisController.onInput) thisController.onInput(evt);
                bitsy.refreshGameData();
            });
        }

        this.update = function (boundObject) {
            this.boundObject = boundObject;
            if (this.boundPropertyName in this.boundObject) {
                this.show();
            } else {
                this.hide();
                return;
            }

            if (this.nestedControllers.length > 0) {
                this.nestedControllers.forEach(function (c) {c.update(this.boundObject[this.boundPropertyName])}, this);
            } else {
                if (this.elementInput.type === 'checkbox') {
                    this.elementInput.checked = this.boundObject[this.boundPropertyName]
                } else {
                    this.elementInput.value = this.convertFromData(this.boundObject[this.boundPropertyName]);
                }
            }
        };

        this.show = function () {
            this.elementDiv.style.display = 'block';
        };
        this.hide = function () {
            this.elementDiv.style.display = 'none';
        };
    },

    updateCameraSettings: function () {
        document.getElementById('settings3dCameraPreset').value = b3d.curCameraPreset || 'custom';
        document.getElementById('settings3dCameraType').value = b3d.mainCamera.type;
        meshPanel.cameraSettingsControllers.forEach(function (controller) {
            controller.update(b3d.mainCamera);
        });
    },

    makeCameraPresetCustom: function () {
        b3d.curCameraPreset = null;
        document.getElementById('settings3dCameraPreset').value = 'custom';
    },

    onChangeCameraPreset: function (event) {
        var newPresetValue = document.getElementById('settings3dCameraPreset').value;

        // ask for confirmation if the current preset was the custom one
        if (!b3d.curCameraPreset && !window.confirm('if you select a different preset, it will overwrite your custom camera configuration. if you want to save your current camera configuration, you can copy it from game data. are you sure you want to select a different preset?')) {
            document.getElementById('settings3dCameraPreset').value = 'custom';
            return;
        }

        if (newPresetValue === 'custom') {
            b3d.curCameraPreset = null;
        } else {
            b3d.curCameraPreset = newPresetValue;

            // create a new camera object from selected preset and replace the previous one
            var newCamera = b3d.createCamera(b3d.cameraPresets[newPresetValue]);
            // if we are in play mode and have the current camera selected, set the new camera as active before deleting the previous one
            if (b3d.scene.activeCamera === b3d.mainCamera.ref) {
                newCamera.activate();
            }
            b3d.mainCamera.ref.dispose();
            b3d.mainCamera = newCamera;
        }

        meshPanel.updateCameraSettings();
        bitsy.refreshGameData();
    },

    onChangeCameraType: function (event) {
        var newType = document.getElementById('settings3dCameraType').value;

        // ask for confirmation
        if (!window.confirm('when you change camera type, some of the settings specific to the current type will be lost. if you want to save your current camera configuration, you can copy it from game data. are you sure you want to select a different camera type?')) {
            document.getElementById('settings3dCameraType').value = b3d.mainCamera.type;
            return;
        }

        meshPanel.makeCameraPresetCustom();

        // preserve properties that are common for all camera types
        // delete current camera and create a new camera of the specified type

        var newCamera = b3d.createCamera({type: newType});

        // copy common properties from the current camera
        b3d.deepCopyObjectState(
            newCamera,
            Object.values(b3d.cameraDataModel.commonProperties)
            .reduce(function (accumulator, curValue) {
                Object.keys(curValue).forEach(function (k) {accumulator[k] = b3d.mainCamera[k]});
                return accumulator;
            }, {})
        );

        if (b3d.scene.activeCamera === b3d.mainCamera.ref) {
            newCamera.activate();
        }
        b3d.mainCamera.ref.dispose();
        b3d.mainCamera = newCamera;

        meshPanel.updateCameraSettings();
        bitsy.refreshGameData();
    },
}; // meshPanel
