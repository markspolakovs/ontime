// get database
const db = require('../app.js').db;

// utils
const { nanoid } = require('nanoid');
const eventDefs = require('../data/eventsDefinition.js');

function _getEventsCount() {
  return db.get('events').size().value();
}

function _pushNew(entry) {
  return db.get('events').push(entry).write();
}

function _insertAt(entry, index) {
  // get events
  let events = db.get('events').value();
  let count = events.length;
  let order = entry.order;

  // Remove order field from object
  delete entry.order;

  // Insert at beggining
  if (order === 0) {
    events.unshift(entry);
  }

  // insert at end
  else if (order >= count) {
    events.push(entry);
  }

  // insert in the middle
  else {
    events.splice(index, 0, entry);
  }

  // save events
  db.set('events', events).write();
}

function _removeById(eventId) {
  return db.get('events').remove({ id: eventId }).write();
}

function getEventEvents() {
  return db.get('events').chain().filter({ type: 'event' }).value();
}

// Updates timer object
function _updateTimers() {
  const results = getEventEvents();
  global.timer.updateEventList(results);
}

// Updates timer object single event
function _updateTimersSingle(id, entry) {
  global.timer.updateSingleEvent(id, entry);
}

// Create controller for GET request to '/events'
// Returns -
exports.eventsGetAll = async (req, res) => {
  const results = db.get('events').value();
  res.json(results);
};

// Create controller for GET request to '/events/:eventId'
// Returns -
exports.eventsGetById = async (req, res) => {
  const e = db.get('events').find({ id: req.params.eventId }).value();
  res.json(e);
};

// Create controller for POST request to '/events/'
// Returns -
exports.eventsPost = async (req, res) => {
  // TODO: Validate event
  if (!req.body) {
    res.status(400).send(`No object found in request`);
    return;
  }

  // ensure structure
  let newEvent = {};
  req.body.id = nanoid(6);

  switch (req.body.type) {
    case 'event':
      newEvent = { ...eventDefs.event, ...req.body };
      break;
    case 'delay':
      newEvent = { ...eventDefs.delay, ...req.body };
      break;
    case 'block':
      newEvent = { ...eventDefs.block, ...req.body };
      break;

    default:
      res
        .status(400)
        .send(`Object type missing or unrecognised: ${req.body.type}`);
      break;
  }

  try {
    // get place where event should be
    const index = newEvent.order || 0;

    // add new event in place
    _insertAt(newEvent, index);

    // update timers
    _updateTimers();

    // reply OK
    res.sendStatus(201);
  } catch (error) {
    console.log(error);
    res.status(400).send(error);
  }
};

// Create controller for PUT request to '/events/'
// Returns -
exports.eventsPut = async (req, res) => {
  // no valid params
  if (!req.body) {
    res.status(400).send(`No object found`);
    return;
  }

  let eventId = req.body.id;
  if (!eventId) {
    res.status(400).send(`Object malformed: id missing`);
    return;
  }

  try {
    db.get('events')
      .find({ id: req.body.id })
      .assign({ ...req.body })
      .update('revision', (n) => n + 1)
      .write();

    // update timer
    _updateTimersSingle(req.body.id, req.body);

    res.sendStatus(200);
  } catch (error) {
    res.status(400).send(error);
  }
};

// Create controller for PATCH request to '/events/'
// Returns -
exports.eventsPatch = async (req, res) => {
  // Code is the same as put, call that
  this.eventsPut(req, res);
};

exports.eventsReorder = async (req, res) => {
  // TODO: Validate event
  if (!req.body) {
    res.status(400).send(`No object found in request`);
    return;
  }

  const { index, from, to } = req.body;

  // get events
  let events = db.get('events').value();
  let idx = events.findIndex((e) => e.id === index, from);

  // Check if item is at given index
  if (idx !== from) {
    res.status(400).send(`Id not found at index`);
    return;
  }

  try {
    // remove item at from
    const [reorderedItem] = events.splice(from, 1);

    // reinsert item at to
    events.splice(to, 0, reorderedItem);

    // save events
    db.set('events', events).write();

    // TODO: would it be more efficient to reorder at timer?
    // update timer
    _updateTimers();

    res.sendStatus(200);
  } catch (error) {
    console.log(error);
    res.status(400).send(error);
  }
};

// Create controller for PATCH request to '/events/applydelay/:eventId'
// Returns -
exports.eventsApplyDelay = async (req, res) => {
  // no valid params
  if (!req.params.eventId) {
    res.status(400).send(`No id found in request`);
    return;
  }

  try {
    // get events
    let events = db.get('events').value();

    // AUX
    let delayIndex = null;
    let blockIndex = null;
    let delayValue = 0;

    for (const [index, e] of events.entries()) {
      if (delayIndex == null) {
        // look for delay
        if (e.id === req.params.eventId && e.type === 'delay') {
          delayValue = e.duration;
          delayIndex = index;
        }
      }

      // apply delay value to all items until block or end
      else {
        if (e.type === 'event') {
          // update times
          e.timeStart += delayValue;
          e.timeEnd += delayValue;

          // increment revision
          e.revision += 1;
        } else if (e.type === 'block') {
          // save id and stop
          blockIndex = index;
          break;
        }
      }
    }

    // delete delay
    events.splice(delayIndex, 1);

    // delete block
    // index would have moved down since we deleted delay
    if (blockIndex) events.splice(blockIndex - 1, 1);

    // update events
    db.set('events', events).write();

    // update timer
    _updateTimers();

    res.sendStatus(201);
  } catch (error) {
    console.log('debug:', error);

    res.status(400).send(error);
  }
};

// Create controller for DELETE request to '/events/:eventId'
// Returns -
exports.eventsDelete = async (req, res) => {
  // no valid params
  if (!req.params.eventId) {
    res.status(400).send(`No id found in request`);
    return;
  }

  try {
    // remove new event
    _removeById(req.params.eventId);

    // update timer
    _updateTimers();

    res.sendStatus(201);
  } catch (error) {
    console.log('debug:', error);

    res.status(400).send(error);
  }
};
